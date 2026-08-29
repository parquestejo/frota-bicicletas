import { normalizeApiPath } from "../../src/shared/route";
import {
  type Env, type Ctx, securityHeaders, json, err, random, digest,
  passwordHash, passwordOK, DbError, db, dbAll, dbCount, uploadReceipt,
  readReceipt, q, cookie, setCookie, body, audit, auth, allow, csrfOK, cleanUser,
} from "./_shared";
import { handleInventoryRoutes } from "./routes/inventory";
import { handleRentalRoutes } from "./routes/rentals";
import { handleFaultAndUserRoutes } from "./routes/faults-users";
import { handleDailyAndActivityRoutes } from "./routes/daily-activity";

export const onRequest: PagesFunction<Env> = async ({
  request,
  env,
  params,
}) => {
  const ctx: Ctx = { env };
  const route = normalizeApiPath(params.path as string | string[] | undefined);
  const parts = route.split("/").filter(Boolean);
  try {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: securityHeaders });
    if (route === "/version" && request.method === "GET")
      return json({
        version: "1.8.1",
        routing: "array-safe",
        database_errors: "detailed",
      });
    if (route === "/bootstrap" && request.method === "POST") {
      if (
        !env.BOOTSTRAP_TOKEN ||
        request.headers.get("X-Bootstrap-Token") !== env.BOOTSTRAP_TOKEN
      )
        return err("Configuração inicial não autorizada.", 403);
      const existing = await db(ctx, "users?select=id&limit=1");
      if (existing.length)
        return err("A configuração inicial já foi concluída.", 409);
      const b = await body(request);
      if (!b.username || !b.full_name || String(b.password || "").length < 6)
        return err(
          "Preencha o nome, utilizador e uma palavra-passe com pelo menos 6 caracteres.",
        );
      await db(ctx, "users", {
        method: "POST",
        body: JSON.stringify({
          full_name: b.full_name,
          username: String(b.username).toLowerCase(),
          password_hash: await passwordHash(b.password),
          role: "admin",
        }),
      });
      return json({ ok: true });
    }
    if (route === "/auth/login" && request.method === "POST") {
      const b = await body(request),
        username = String(b.username || "")
          .trim()
          .toLowerCase(),
        ip = request.headers.get("CF-Connecting-IP") || "local",
        key = await digest(ip + ":" + username),
        since = new Date(Date.now() - 15 * 60000).toISOString();
      const attempts = await db(
        ctx,
        `login_attempts?attempt_key=eq.${q(key)}&created_at=gt.${q(since)}&success=eq.false&select=id`,
      );
      if (attempts.length >= 5)
        return err("Demasiadas tentativas. Aguarde 15 minutos.", 429);
      const users = await db(ctx, `users?username=eq.${q(username)}&select=*`),
        u = users[0];
      const ok =
        !!u &&
        u.active &&
        (await passwordOK(String(b.password || ""), u.password_hash));
      await db(ctx, "login_attempts", {
        method: "POST",
        body: JSON.stringify({ attempt_key: key, success: ok }),
      });
      if (!ok)
        return err("Nome de utilizador ou palavra-passe incorretos.", 401);
      const token = random(),
        csrfToken = random(24),
        tokenHash = await digest(token);
      await db(ctx, "sessions", {
        method: "POST",
        body: JSON.stringify({
          user_id: u.id,
          token_hash: tokenHash,
          csrf_token: csrfToken,
          expires_at: new Date(Date.now() + 8 * 3600000).toISOString(),
        }),
      });
      await db(ctx, `users?id=eq.${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ last_login_at: new Date().toISOString() }),
      });
      return json({ user: cleanUser(u), csrf: csrfToken }, 200, {
        "Set-Cookie": setCookie(ctx, token),
      });
    }
    if (!(await auth(ctx, request)))
      return err("A sessão terminou. Volte a iniciar sessão.", 401);
    if (!csrfOK(ctx, request))
      return err("Pedido inválido. Atualize a página e tente novamente.", 403);
    if (route === "/auth/me" && request.method === "GET")
      return json({ user: cleanUser(ctx.user), csrf: ctx.csrf });
    if (route === "/auth/logout" && request.method === "POST") {
      await db(ctx, `sessions?id=eq.${ctx.session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      });
      return json({ ok: true }, 200, { "Set-Cookie": setCookie(ctx, "", 0) });
    }
    if (route === "/auth/change-password" && request.method === "POST") {
      const b = await body(request);
      if (
        !(await passwordOK(
          String(b.current_password || ""),
          ctx.user.password_hash,
        ))
      )
        return err("A palavra-passe atual está incorreta.", 400);
      if (String(b.password || "").length < 6)
        return err("A nova palavra-passe deve ter pelo menos 6 caracteres.");
      await db(ctx, `users?id=eq.${ctx.user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ password_hash: await passwordHash(b.password) }),
      });
      await db(
        ctx,
        `sessions?user_id=eq.${ctx.user.id}&id=neq.${ctx.session.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ revoked_at: new Date().toISOString() }),
        },
      );
      await audit(ctx, "alterar palavra-passe", "utilizador", ctx.user.id);
      return json({ ok: true });
    }
    const handlers = [
      handleInventoryRoutes,
      handleRentalRoutes,
      handleFaultAndUserRoutes,
      handleDailyAndActivityRoutes,
    ];
    for (const handler of handlers) {
      const response = await handler(ctx, request, route, parts);
      if (response) return response;
    }
    return err("Página ou operação não encontrada.", 404);
  } catch (e) {
    console.error(e);
    const m = String((e as Error).message);
    if (e instanceof DbError) {
      if (e.code === "missing_url")
        return err(
          "Falta configurar SUPABASE_URL no Cloudflare e voltar a publicar.",
          500,
        );
      if (e.code === "missing_key")
        return err(
          "Falta configurar a chave secreta do Supabase no Cloudflare e voltar a publicar.",
          500,
        );
      if (e.status === 401 || e.status === 403)
        return err(
          `O Supabase recusou a chave configurada (erro ${e.status}). Confirme a chave service_role e volte a publicar.`,
          500,
        );
      if (e.status === 404 || e.code === "PGRST205")
        return err(
          `A base de dados não encontrou uma tabela necessária (${e.code}). Confirme se executou integralmente o ficheiro 001_initial.sql e se o esquema public está exposto.`,
          500,
        );
      if (e.code === "23505")
        return err("Já existe um registo com estes dados.", 409);
      return err(
        `Erro de base de dados: código ${e.code}, estado ${e.status}.`,
        500,
      );
    }
    if (m.includes("bike_not_available"))
      return err(
        "Uma das bicicletas já não está disponível. Atualize a página.",
        409,
      );
    if (m.includes("bike_has_open_rental"))
      return err("Este item tem um aluguer em aberto. Registe primeiro a devolução.", 409);
    if (m.includes("rental_required_for_rented_status"))
      return err("O estado Alugada só pode ser atribuído através de um aluguer.", 409);
    if (m.includes("bike_has_open_fault"))
      return err("Este item tem uma avaria pendente. Atualize primeiro a ocorrência na área de manutenção.", 409);
    if (m.includes("other_open_faults"))
      return err("O item ainda tem outra avaria pendente e não pode ficar disponível.", 409);
    if (m.includes("duplicate") || m.includes("23505"))
      return err("Já existe um registo com estes dados.", 409);
    const name = e instanceof Error ? e.name : "Erro desconhecido";
    return err(`Erro interno ${name}: ${m.slice(0, 180)}`, 500);
  }
};

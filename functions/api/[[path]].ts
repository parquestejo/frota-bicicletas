import { normalizeApiPath } from "../../src/shared/route";
import {
  type Env, type Ctx, securityHeaders, json, err, random, digest,
  passwordHash, passwordOK, DbError, db, dbAll, dbCount, uploadReceipt,
  readReceipt, q, cookie, setCookie, body, audit, auth, allow, csrfOK, cleanUser,
  flushPendingAlertEmails,
} from "./_shared";
import { handleInventoryRoutes } from "./routes/inventory";
import { handleRentalRoutes } from "./routes/rentals";
import { handleFaultAndUserRoutes } from "./routes/faults-users";
import { handleDailyAndActivityRoutes } from "./routes/daily-activity";
import { handleNotificationRoutes } from "./routes/notifications";
import { flushEmailOutbox, runScheduledEmailJobs } from "./email";

export const onRequest: PagesFunction<Env> = async ({
  request,
  env,
  params,
  waitUntil,
}) => {
  const ctx: Ctx = { env, startedAt: Date.now(), dbDurationMs: 0, dbCalls: 0 };
  const route = normalizeApiPath(params.path as string | string[] | undefined);
  const parts = route.split("/").filter(Boolean);
  try {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: securityHeaders });
    if (route === "/version" && request.method === "GET")
      return json({
        version: "2.5.2",
        routing: "array-safe",
        database_errors: "detailed",
      });
    if (route === "/jobs/email" && request.method === "POST") {
      if (!env.JOB_SECRET || request.headers.get("Authorization") !== `Bearer ${env.JOB_SECRET}`)
        return err("Tarefa automática não autorizada.", 403);
      return json(await runScheduledEmailJobs(ctx));
    }
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
      handleNotificationRoutes,
    ];
    for (const handler of handlers) {
      const response = await handler(ctx, request, route, parts);
      if (response) {
        if (!["GET", "HEAD"].includes(request.method))
          waitUntil(Promise.all([
            flushPendingAlertEmails(ctx),
            flushEmailOutbox(ctx),
          ]).catch((error) => console.error("alert_email", error)));
        const total=Date.now()-(ctx.startedAt||Date.now()),headers=new Headers(response.headers);
        headers.set("Server-Timing",`app;dur=${total}, db;dur=${ctx.dbDurationMs||0}`);
        headers.set("X-Response-Time",`${total}ms`);
        headers.set("X-Database-Calls",String(ctx.dbCalls||0));
        if(total>1000)console.warn("slow_request",{route,method:request.method,total,db_ms:ctx.dbDurationMs,db_calls:ctx.dbCalls});
        return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
      }
    }
    return err("Página ou operação não encontrada.", 404);
  } catch (e) {
    console.error(e);
    const m = String((e as Error).message);
    if (e instanceof DbError) {
      const detail = e.detail.toLowerCase();
      const ruleMessages: Record<string, [string, number]> = {
        bike_not_available: ["Um dos itens já não está disponível. Atualize a lista e escolha outro.", 409],
        bike_has_open_rental: ["Este item tem um aluguer em aberto. Registe primeiro a devolução.", 409],
        bike_has_other_open_rental: ["Um dos itens já está associado a outro aluguer em aberto.", 409],
        bike_rental_period_overlap: ["O item já está associado a outro aluguer no mesmo período.", 409],
        invalid_deposit_authorization: ["A caução do cliente não está ativa. Registe uma nova pré-autorização.", 409],
        invalid_school_items: ["O Cartão Escolar permite uma bicicleta e, opcionalmente, um capacete.", 400],
        invalid_charged_amount: ["O valor calculado foi alterado ou está desatualizado. Atualize a página e tente novamente.", 409],
        duration_must_increase: ["A nova duração tem de ser superior à duração atual.", 400],
        cannot_remove_last_bike: ["O aluguer tem de manter pelo menos uma bicicleta.", 409],
        invalid_return_kiosk: ["Selecione um quiosque válido para a devolução.", 400],
        invalid_returned_at: ["A data de devolução não é válida.", 400],
        correction_reason_required: ["Indique o motivo da correção com pelo menos cinco caracteres.", 400],
        rental_not_open: ["Este aluguer já não está em aberto. Atualize a página.", 409],
        rental_not_completed: ["Esta operação só está disponível para alugueres concluídos.", 409],
        duplicate_rental_item: ["Este item já pertence ao aluguer.", 409],
        partial_return_not_allowed: ["Nos alugueres não institucionais têm de ser devolvidos todos os itens em conjunto.", 409],
      };
      const translated=Object.entries(ruleMessages).find(([code])=>detail.includes(code));
      if(translated){const [message,status]=translated[1];return err(message,status);}
      if (detail.includes("bike_has_open_rental"))
        return err("Esta bicicleta ainda tem um aluguer em aberto. Registe primeiro a devolução e depois atualize a avaria.", 409);
      if (detail.includes("other_open_faults"))
        return err("Esta bicicleta tem outra avaria pendente. Resolva ou cancele primeiro a outra ocorrência, ou mantenha a bicicleta indisponível.", 409);
      if (detail.includes("final_status_required"))
        return err("Ao resolver a avaria, selecione o estado final da bicicleta.", 400);
      if (detail.includes("invalid_fault_status"))
        return err("O estado selecionado para a avaria não é válido.", 400);
      if (detail.includes("fault_not_found"))
        return err("A ocorrência já não existe. Atualize a página.", 404);
      if (detail.includes("bike_has_open_fault"))
        return err("A bicicleta tem uma avaria pendente. Atualize a ocorrência na área de Avarias e manutenção.", 409);
      if (detail.includes("rental_required_for_rented_status"))
        return err("O estado Alugada só pode ser atribuído através de um aluguer.", 409);
      if (detail.includes("invalid_kiosk"))
        return err("A localização selecionada não é válida.", 400);
      if (detail.includes("invalid_bike_status"))
        return err("O estado selecionado para a bicicleta não é válido.", 400);
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
      const occurrence=crypto.randomUUID().slice(0,8).toUpperCase();
      console.error("database_error",occurrence,e.code,e.status,e.detail);
      return err(`Não foi possível concluir a operação. Código de ocorrência: ${occurrence}.`,500);
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
    const occurrence=crypto.randomUUID().slice(0,8).toUpperCase();
    console.error("internal_error",occurrence,e);
    return err(`Ocorreu um erro interno. Código de ocorrência: ${occurrence}.`, 500);
  }
};

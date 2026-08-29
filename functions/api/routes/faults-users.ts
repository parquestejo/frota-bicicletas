import {
  type Ctx, json, err, db, dbAll, dbCount, body, audit, allow, q,
  passwordHash, uploadReceipt, readReceipt, cleanUser,
} from "../_shared";

export async function handleFaultAndUserRoutes(ctx: Ctx, request: Request, route: string, parts: string[]) {
    if (route === "/faults/report-options" && request.method === "GET") {
      const rentalKiosks=ctx.user.role==='funcionario'?await db(ctx,'kiosks?active=eq.true&allows_rentals=eq.true&select=id'):[];
      const kioskIds=rentalKiosks.map((k:any)=>k.id),kioskFilter=ctx.user.role==='funcionario'?`&kiosk_id=in.(${kioskIds.join(',')})`:'';
      const bikes = ctx.user.role==='funcionario'&&!kioskIds.length?[]:await db(ctx,`bikes?active=eq.true${kioskFilter}&select=id,code,asset_type,model,kiosk_id&order=code`);
      return json({ bikes });
    }
    if (route === "/faults" && request.method === "GET") {
      if (!['admin','manutencao'].includes(ctx.user.role))
        return err("Acesso reservado a administradores e manutenção.", 403);
      const [faults, bikes] = await Promise.all([
        dbAll(
          ctx,
          "faults?select=*,bike:bikes(*),created_by_user:users!faults_created_by_fkey(full_name)&order=created_at.desc",
        ),
        db(ctx, "bikes?active=eq.true&select=*&order=code"),
      ]);
      return json({ faults, bikes });
    }
    if (route === "/faults" && request.method === "POST") {
      const b = await body(request);
      if (!b.bike_id || !b.description?.trim())
        return err("Selecione a bicicleta e descreva a avaria.");
      const description=String(b.description).trim();
      if(description.length>2000) return err("A descrição não pode exceder 2000 caracteres.");
      const bikePath=ctx.user.role==='funcionario'
        ? `bikes?id=eq.${q(String(b.bike_id))}&active=eq.true&select=id,kiosk:kiosks!inner(allows_rentals)&kiosk.allows_rentals=eq.true`
        : `bikes?id=eq.${q(String(b.bike_id))}&active=eq.true&select=id`;
      if(!(await db(ctx,bikePath))[0])
        return err("O item não está disponível para comunicação neste perfil.",403);
      const rows = await db(ctx, "rpc/create_fault", {
        method: "POST",
        body: JSON.stringify({
          p_bike_id: b.bike_id,
          p_origin: "comunicada diretamente",
          p_category: b.category,
          p_description: description,
          p_severity: b.severity,
          p_usable: !!b.usable,
          p_user_id: ctx.user.id,
        }),
      });
      return json(rows, 201);
    }
    if (parts[0] === "faults" && parts[1] && request.method === "PATCH") {
      if (!["admin", "manutencao"].includes(ctx.user.role))
        return err("Acesso reservado a administradores e manutenção.", 403);
      const b = await body(request);
      const result = await db(ctx, "rpc/update_fault", {
        method: "POST",
        body: JSON.stringify({
          p_fault_id: parts[1],
          p_status: b.status,
          p_final_bike_status: b.final_bike_status || null,
          p_user_id: ctx.user.id,
          p_note: b.note || null,
        }),
      });
      return json(result);
    }
    if (route === "/users" && request.method === "GET") {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const [users, kiosks] = await Promise.all([
        db(
          ctx,
          "users?select=id,full_name,username,role,usual_kiosk_id,active,last_login_at,created_at&order=full_name",
        ),
        db(ctx, "kiosks?active=eq.true&allows_rentals=eq.true&select=*"),
      ]);
      return json({ users, kiosks });
    }
    if (route === "/users" && request.method === "POST") {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const b = await body(request);
      if (!b.full_name || !b.username || String(b.password || "").length < 6)
        return err(
          "Preencha os dados e use uma palavra-passe com pelo menos 6 caracteres.",
        );
      const role =
        b.role === "admin"
          ? "admin"
          : b.role === "manutencao"
            ? "manutencao"
            : "funcionario";
      const rows = await db(ctx, "users", {
        method: "POST",
        body: JSON.stringify({
          full_name: b.full_name,
          username: String(b.username).toLowerCase(),
          password_hash: await passwordHash(b.password),
          role,
          usual_kiosk_id: b.usual_kiosk_id || null,
        }),
      });
      await audit(
        ctx,
        "criar",
        "utilizador",
        rows[0].id,
        null,
        cleanUser(rows[0]),
      );
      return json(cleanUser(rows[0]), 201);
    }
    if (
      parts[0] === "users" &&
      parts[1] &&
      parts.length === 2 &&
      request.method === "PATCH"
    ) {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const old = (await db(ctx, `users?id=eq.${parts[1]}&select=*`))[0],
        b = await body(request);
      if (!old) return err("Utilizador não encontrado.", 404);
      if (
        old.username === "admin" &&
        (b.active === false ||
          (b.role && b.role !== "admin") ||
          (b.username && String(b.username).trim().toLowerCase() !== "admin"))
      )
        return err(
          "A conta admin está protegida e não pode ser desativada, despromovida ou renomeada.",
          400,
        );
      if (
        parts[1] === ctx.user.id &&
        (b.active === false || (b.role && b.role !== "admin"))
      )
        return err(
          "Não pode desativar nem retirar o perfil de administrador da sua própria conta.",
          400,
        );
      const allowed = [
        "full_name",
        "username",
        "role",
        "usual_kiosk_id",
        "active",
      ];
      const update: any = Object.fromEntries(
        Object.entries(b).filter(([k]) => allowed.includes(k)),
      );
      if (update.username !== undefined) {
        update.username = String(update.username).trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,50}$/.test(update.username))
          return err(
            "O nome de utilizador deve ter entre 3 e 50 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.",
          );
      }
      if (update.full_name !== undefined && !String(update.full_name).trim())
        return err("O nome não pode ficar vazio.");
      if (update.full_name !== undefined)
        update.full_name = String(update.full_name).trim();
      if (update.role !== undefined)
        update.role =
          update.role === "admin"
            ? "admin"
            : update.role === "manutencao"
              ? "manutencao"
              : "funcionario";
      const rows = await db(ctx, `users?id=eq.${parts[1]}`, {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      await audit(
        ctx,
        "alterar",
        "utilizador",
        parts[1],
        cleanUser(old),
        cleanUser(rows[0]),
      );
      return json(cleanUser(rows[0]));
    }
    if (
      parts[0] === "users" &&
      parts[2] === "password" &&
      request.method === "POST"
    ) {
      if (!allow(ctx, "admin"))
        return err("Acesso reservado a administradores.", 403);
      const b = await body(request);
      if (String(b.password || "").length < 6)
        return err("A palavra-passe deve ter pelo menos 6 caracteres.");
      await db(ctx, `users?id=eq.${parts[1]}`, {
        method: "PATCH",
        body: JSON.stringify({ password_hash: await passwordHash(b.password) }),
      });
      await db(ctx, `sessions?user_id=eq.${parts[1]}`, {
        method: "PATCH",
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      });
      await audit(ctx, "redefinir palavra-passe", "utilizador", parts[1]);
      return json({ ok: true });
    }
  return null;
}

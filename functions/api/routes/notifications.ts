import { type Ctx, audit, db, err, json, q } from "../_shared";

export async function handleNotificationRoutes(ctx: Ctx, request: Request, route: string, parts: string[]) {
  if (parts[0] !== "notifications") return null;
  if (!["admin", "manutencao"].includes(ctx.user.role))
    return err("Não tem acesso às notificações de avarias.", 403);

  if (route === "/notifications" && request.method === "GET") {
    const rows = await db(
      ctx,
      `notifications?user_id=eq.${q(ctx.user.id)}&select=*,fault:faults(id,status,severity,bike:bikes(id,code,kiosk:kiosks(name)))&order=created_at.desc&limit=50`,
    );
    return json({
      notifications: rows,
      unread: rows.filter((item: any) => !item.read_at).length,
    });
  }

  if (parts[1] && parts[2] === "read" && request.method === "PATCH") {
    const current = (await db(ctx, `notifications?id=eq.${q(parts[1])}&user_id=eq.${q(ctx.user.id)}&select=id,read_at`))[0];
    if (!current) return err("Notificação não encontrada.", 404);
    if (!current.read_at)
      await db(ctx, `notifications?id=eq.${q(parts[1])}&user_id=eq.${q(ctx.user.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ read_at: new Date().toISOString() }),
      });
    return json({ ok: true });
  }

  if (route === "/notifications/read-all" && request.method === "POST") {
    await db(ctx, `notifications?user_id=eq.${q(ctx.user.id)}&read_at=is.null`, {
      method: "PATCH",
      body: JSON.stringify({ read_at: new Date().toISOString() }),
    });
    await audit(ctx, "ler todas", "notificações");
    return json({ ok: true });
  }
  return err("Operação de notificações não encontrada.", 404);
}

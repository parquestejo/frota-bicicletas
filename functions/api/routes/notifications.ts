import { type Ctx, audit, body, db, err, json, q } from "../_shared";

const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const cleanEmails = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.map((item) => String(item).trim().toLowerCase()).filter(Boolean))]
  : [];

export async function handleNotificationRoutes(ctx: Ctx, request: Request, route: string, parts: string[]) {
  if (route === "/operations" && request.method === "GET") {
    if (ctx.user.role !== "admin") return err("Acesso reservado a administradores.", 403);
    const since=new Date(Date.now()-7*86400000).toISOString();
    const [diagnostics,jobRuns,emailJobs,performance]=await Promise.all([
      db(ctx,"rpc/operational_diagnostics",{method:"POST",body:"{}"}),
      db(ctx,"automated_job_runs?select=*&order=finished_at.desc&limit=20"),
      db(ctx,"email_outbox?select=id,event_type,status,attempts,last_error,created_at,sent_at&order=created_at.desc&limit=50"),
      db(ctx,`api_performance_logs?created_at=gte.${q(since)}&select=route,method,status_code,duration_ms,db_duration_ms,db_calls,created_at&order=created_at.desc&limit=1000`),
    ]);
    const grouped=new Map<string,any[]>();
    for(const row of performance){const list=grouped.get(row.route)||[];list.push(row);grouped.set(row.route,list);}
    const routePerformance=[...grouped.entries()].map(([path,rows])=>({route:path,requests:rows.length,average_ms:Math.round(rows.reduce((s,r)=>s+Number(r.duration_ms),0)/rows.length),maximum_ms:Math.max(...rows.map(r=>Number(r.duration_ms))),average_db_calls:Math.round(rows.reduce((s,r)=>s+Number(r.db_calls),0)/rows.length*10)/10,errors:rows.filter(r=>Number(r.status_code)>=400).length})).sort((a,b)=>b.average_ms-a.average_ms).slice(0,20);
    const emailSummary={pending:emailJobs.filter((x:any)=>x.status==="pending"||x.status==="processing").length,failed:emailJobs.filter((x:any)=>x.status==="failed").length,sent:emailJobs.filter((x:any)=>x.status==="sent").length,last_sent:emailJobs.find((x:any)=>x.sent_at)?.sent_at||null};
    return json({diagnostics,job_runs:jobRuns,email_jobs:emailJobs,email_summary:emailSummary,performance:routePerformance});
  }
  if (parts[0] === "operations" && parts[1] === "email" && parts[2] && parts[3] === "retry" && request.method === "POST") {
    if (ctx.user.role !== "admin") return err("Acesso reservado a administradores.", 403);
    const current=(await db(ctx,`email_outbox?id=eq.${q(parts[2])}&select=*&limit=1`))[0];
    if(!current)return err("Envio não encontrado.",404);
    if(current.status==="sent")return err("Este email já foi enviado.",409);
    await db(ctx,`email_outbox?id=eq.${q(parts[2])}`,{method:"PATCH",body:JSON.stringify({status:"pending",attempts:0,available_at:new Date().toISOString(),locked_at:null,last_error:null})});
    await audit(ctx,"repetir envio","email",parts[2],{status:current.status,attempts:current.attempts},{status:"pending",attempts:0});
    return json({ok:true});
  }
  if (parts[0] === "email-settings") {
    if (ctx.user.role !== "admin") return err("Acesso reservado a administradores.", 403);
    if (route === "/email-settings" && request.method === "GET") {
      const [settings, kiosks, jobs] = await Promise.all([
        db(ctx, "email_settings?id=eq.true&select=*&limit=1"),
        db(ctx, "kiosks?active=eq.true&allows_rentals=eq.true&select=id,name,closure_due_time,closure_grace_minutes,operating_days&order=name"),
        db(ctx, "email_outbox?select=id,event_type,status,attempts,last_error,created_at,sent_at&order=created_at.desc&limit=30"),
      ]);
      return json({
        settings: settings[0], kiosks, jobs,
        readiness: {
          resend_api_key: !!ctx.env.RESEND_API_KEY,
          sender: !!ctx.env.ALERT_EMAIL_FROM,
          job_secret: !!ctx.env.JOB_SECRET,
          app_url: !!ctx.env.APP_URL,
        },
      });
    }
    if (route === "/email-settings" && request.method === "PATCH") {
      const b = await body(request), admins = cleanEmails(b.admin_recipients), maintenance = cleanEmails(b.maintenance_recipients);
      if ([...admins, ...maintenance].some((email) => !validEmail(email))) return err("Existe um endereço de email inválido.");
      const day = Number(b.weekly_day), time = String(b.weekly_time || "");
      if (!Number.isInteger(day) || day < 1 || day > 7 || !/^\d{2}:\d{2}$/.test(time)) return err("Indique um dia e uma hora válidos.");
      const old = (await db(ctx, "email_settings?id=eq.true&select=*"))[0];
      const rows = await db(ctx, "email_settings?id=eq.true", { method: "PATCH", body: JSON.stringify({
        enabled: !!b.enabled, admin_recipients: admins, maintenance_recipients: maintenance,
        weekly_day: day, weekly_time: time, updated_at: new Date().toISOString(),
      }) });
      await audit(ctx, "configurar", "emails automáticos", "principal", old, rows[0]);
      return json(rows[0]);
    }
    if (route === "/email-settings/test" && request.method === "POST") {
      const rows = await db(ctx, "email_outbox", { method: "POST", body: JSON.stringify({
        event_type: "test_email", dedupe_key: `test-email:${ctx.user.id}:${Date.now()}`,
        recipient_group: "admin", payload: { requested_by: ctx.user.id },
      }) });
      return json({ queued: true, id: rows[0]?.id }, 201);
    }
    if (parts[1] === "kiosks" && parts[2] && request.method === "PATCH") {
      const b = await body(request), grace = Number(b.closure_grace_minutes), days: number[] = Array.isArray(b.operating_days) ? [...new Set<number>(b.operating_days.map(Number))] : [];
      const due = String(b.closure_due_time || "").trim() || null;
      if (due && !/^\d{2}:\d{2}$/.test(due)) return err("Indique uma hora-limite válida.");
      if (!Number.isInteger(grace) || grace < 0 || grace > 240 || !days.length || days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) return err("A tolerância ou os dias de funcionamento são inválidos.");
      const old = (await db(ctx, `kiosks?id=eq.${q(parts[2])}&select=*`))[0];
      if (!old) return err("Quiosque não encontrado.", 404);
      const rows = await db(ctx, `kiosks?id=eq.${q(parts[2])}`, { method: "PATCH", body: JSON.stringify({ closure_due_time: due, closure_grace_minutes: grace, operating_days: days }) });
      await audit(ctx, "configurar fecho", "quiosque", old.id, old, rows[0]);
      return json(rows[0]);
    }
    return err("Operação de emails não encontrada.", 404);
  }
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

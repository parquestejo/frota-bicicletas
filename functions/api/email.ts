import { type Ctx, db, q } from "./_shared";

type EmailSettings = {
  enabled: boolean;
  admin_recipients: string[];
  maintenance_recipients: string[];
  weekly_day: number;
  weekly_time: string;
};
type EmailJob = {
  job_id: string;
  event_type: string;
  dedupe_key: string;
  entity_id?: string;
  recipient_group: "admin" | "maintenance_and_admin";
  payload: Record<string, unknown>;
  attempts: number;
};

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[character] || character));
const money = (value: unknown) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(value || 0));
const fmt = (value?: string) => value ? new Intl.DateTimeFormat("pt-PT", {
  dateStyle: "short", timeStyle: "short", timeZone: "Europe/Lisbon",
}).format(new Date(value)) : "—";
const duration = (raw: unknown) => {
  const minutes = Math.max(0, Math.round(Number(raw || 0)));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
};
const uniqueEmails = (...lists: (string[] | undefined)[]) => [...new Set(lists.flatMap((list) => list || []).map((item) => item.trim().toLowerCase()).filter(Boolean))];
const envEmails = (raw?: string) => String(raw || "").split(/[,;]/).map((item) => item.trim()).filter(Boolean);

async function settings(ctx: Ctx): Promise<EmailSettings | null> {
  const row = (await db(ctx, "email_settings?id=eq.true&select=*&limit=1"))[0];
  return row || null;
}

function emailFrame(title: string, content: string, appUrl?: string) {
  const link = appUrl ? `<p style="margin-top:24px"><a href="${escapeHtml(appUrl)}" style="background:#e8a328;color:#353635;padding:10px 16px;text-decoration:none;border-radius:6px;font-weight:bold">Abrir aplicação</a></p>` : "";
  return `<div style="font-family:Arial,sans-serif;color:#353635;max-width:680px;margin:auto"><div style="border-bottom:5px solid #e8a328;padding:12px 0"><strong style="font-size:20px">PARQUES TEJO</strong></div><h1 style="font-size:22px">${escapeHtml(title)}</h1>${content}${link}<p style="margin-top:28px;color:#858384;font-size:12px">Mensagem automática da Gestão da Frota de Bicicletas.</p></div>`;
}

async function renderEmail(ctx: Ctx, job: EmailJob) {
  const appUrl = String(ctx.env.APP_URL || "").replace(/\/$/, "");
  if (job.event_type === "test_email") {
    const subject = "Teste de emails — Gestão da Frota";
    const content = "<p>A configuração de emails da aplicação está operacional.</p>";
    return { subject, html: emailFrame(subject, content, appUrl), text: `${subject}\nA configuração de emails da aplicação está operacional.` };
  }
  if (job.event_type === "fault_created" || job.event_type === "fault_resolved") {
    const fault = (await db(ctx, `faults?id=eq.${q(job.entity_id || "")}&select=*,bike:bikes(code,kiosk:kiosks(name)),created_by_user:users!faults_created_by_fkey(full_name),interventions:maintenance_interventions(description,created_at,created_by_user:users!maintenance_interventions_created_by_fkey(full_name))&limit=1`))[0];
    if (!fault) throw new Error("A avaria associada ao email já não existe.");
    const resolved = job.event_type === "fault_resolved";
    const lastIntervention = [...(fault.interventions || [])].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    const subject = `${resolved ? "Bicicleta reparada" : "Nova avaria"} — ${fault.bike?.code || "Item"}`;
    const rows = [
      ["Localização", fault.bike?.kiosk?.name], ["Gravidade", fault.severity],
      ["Categoria", fault.category], ["Descrição", fault.description],
      [resolved ? "Reparação" : "Comunicada por", resolved ? (lastIntervention?.description || fault.notes || "Sem descrição") : fault.created_by_user?.full_name],
      ...(resolved ? [["Responsável", lastIntervention?.created_by_user?.full_name || "—"]] : []),
      ...(resolved ? [["Tempo até resolução", duration((new Date(fault.resolved_at || Date.now()).getTime() - new Date(fault.created_at).getTime()) / 60000)]] : []),
    ];
    const html = emailFrame(subject, rows.map(([label, value]) => `<p><b>${escapeHtml(label)}:</b> ${escapeHtml(value || "—")}</p>`).join(""), appUrl && `${appUrl}/avarias?fault=${fault.id}`);
    return { subject, html, text: [subject, ...rows.map(([label, value]) => `${label}: ${value || "—"}`)].join("\n") };
  }
  if (job.event_type === "closure_submitted") {
    const closure = (await db(ctx, `daily_closures?id=eq.${q(job.entity_id || "")}&select=*,kiosk:kiosks(name),user:users!daily_closures_user_id_fkey(full_name,username)&limit=1`))[0];
    if (!closure) throw new Error("O fecho associado ao email já não existe.");
    const subject = `Fecho diário — ${closure.kiosk?.name} — ${closure.report_date}`;
    const rows = [
      ["Vigilante", closure.user?.full_name], ["Alugueres", closure.rental_count],
      ["Bicicletas", closure.bike_count], ["Acessórios", closure.accessory_count],
      ["Multibanco", money(closure.card_total)], ["Observações", closure.observations || "Sem observações"],
      ["Submetido em", fmt(closure.submitted_at)],
    ];
    const html = emailFrame(subject, rows.map(([label, value]) => `<p><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</p>`).join(""), appUrl && `${appUrl}/fecho-diario`);
    return { subject, html, text: [subject, ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n") };
  }
  if (job.event_type === "closure_missing") {
    const kioskName = String(job.payload.kiosk_name || "Quiosque");
    const reportDate = String(job.payload.report_date || "");
    const subject = `Fecho em falta — ${kioskName} — ${reportDate}`;
    const content = `<p>Não existe um fecho submetido para <b>${escapeHtml(kioskName)}</b> no dia <b>${escapeHtml(reportDate)}</b>, depois da hora-limite configurada.</p>`;
    return { subject, html: emailFrame(subject, content, appUrl && `${appUrl}/fecho-diario`), text: `${subject}\nNão existe um fecho submetido depois da hora-limite configurada.` };
  }
  if (job.event_type === "weekly_summary") {
    const from = String(job.payload.from || ""), to = String(job.payload.to || "");
    const [analytics, payments, closures, faults] = await Promise.all([
      db(ctx, "rpc/rental_management_analytics", { method: "POST", body: JSON.stringify({ p_from: from, p_to: to }) }),
      db(ctx, "rpc/rental_payment_analytics", { method: "POST", body: JSON.stringify({ p_from: from, p_to: to }) }),
      db(ctx, `daily_closures?report_date=gte.${q(from)}&report_date=lte.${q(to)}&status=eq.Submetido&select=id,card_total`),
      db(ctx, `faults?created_at=gte.${q(`${from}T00:00:00Z`)}&created_at=lt.${q(`${to}T23:59:59Z`)}&select=id,status`),
    ]);
    const subject = `Resumo semanal dos quiosques — ${from} a ${to}`;
    const rows = [
      ["Alugueres", analytics.rental_count], ["Itens alugados", analytics.item_count],
      ["Receita registada", money(analytics.revenue)], ["Alugueres gratuitos", payments.free_rental_count],
      ["Duração média", duration(analytics.average_duration_minutes)], ["Dia com maior procura", analytics.busiest_weekday],
      ["Fechos submetidos", closures.length], ["Total declarado nos fechos", money(closures.reduce((sum: number, row: any) => sum + Number(row.card_total || 0), 0))],
      ["Novas avarias", faults.length], ["Dias sem bicicletas", analytics.stockout_days],
    ];
    const html = emailFrame(subject, `<table style="border-collapse:collapse;width:100%">${rows.map(([label, value]) => `<tr><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(label)}</td><td style="padding:8px;border-bottom:1px solid #ddd;text-align:right"><b>${escapeHtml(value)}</b></td></tr>`).join("")}</table>`, appUrl && `${appUrl}/relatorios`);
    return { subject, html, text: [subject, ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n") };
  }
  throw new Error(`Tipo de email desconhecido: ${job.event_type}`);
}

export async function flushEmailOutbox(ctx: Ctx) {
  const current = await settings(ctx);
  const apiKey = ctx.env.RESEND_API_KEY, from = ctx.env.ALERT_EMAIL_FROM;
  if (!current?.enabled || !apiKey || !from) return { processed: 0 };
  const jobs: EmailJob[] = await db(ctx, "rpc/claim_email_outbox", { method: "POST", body: JSON.stringify({ p_limit: 10 }) });
  let processed = 0;
  for (const job of jobs || []) {
    const fallback = envEmails(ctx.env.ALERT_EMAIL_TO);
    const recipients = job.recipient_group === "maintenance_and_admin"
      ? uniqueEmails(current.admin_recipients, current.maintenance_recipients, fallback)
      : uniqueEmails(current.admin_recipients, fallback);
    try {
      if (!recipients.length) throw new Error("Não existem destinatários configurados para este aviso.");
      const message = await renderEmail(ctx, job);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `frota-${job.job_id}` },
        body: JSON.stringify({ from, to: recipients, ...message }),
      });
      const result: any = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result.message || `Resend ${response.status}`));
      await db(ctx, `email_outbox?id=eq.${q(job.job_id)}`, { method: "PATCH", body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: result.id || null, last_error: null }) });
      processed++;
    } catch (reason) {
      const exhausted = Number(job.attempts || 0) >= 5;
      await db(ctx, `email_outbox?id=eq.${q(job.job_id)}`, { method: "PATCH", body: JSON.stringify({
        status: exhausted ? "failed" : "pending",
        available_at: new Date(Date.now() + Math.min(60, 5 * Number(job.attempts || 1)) * 60000).toISOString(),
        last_error: String((reason as Error).message).slice(0, 500),
      }) });
    }
  }
  return { processed };
}

const dateShift = (dateKey: string, days: number) => {
  const value = new Date(`${dateKey}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
export async function runScheduledEmailJobs(ctx: Ctx, now = new Date()) {
  const current = await settings(ctx);
  if (!current?.enabled) return { queued: 0, processed: 0 };
  const localDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon" }).format(now);
  const localTime = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Lisbon", weekday: "short" }).format(now);
  const isoDay = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[weekdayName];
  let queued = 0;
  const insertJob = async (job: Record<string, unknown>) => {
    const rows = await db(ctx, "email_outbox?on_conflict=dedupe_key", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(job),
    });
    queued += Array.isArray(rows) ? rows.length : 0;
  };
  if (isoDay === Number(current.weekly_day) && localTime >= String(current.weekly_time).slice(0, 5)) {
    const to = dateShift(localDate, -1), from = dateShift(localDate, -7);
    await insertJob({ event_type: "weekly_summary", dedupe_key: `weekly-summary:${from}:${to}`, recipient_group: "admin", payload: { from, to } });
  }
  const kiosks = await db(ctx, "kiosks?active=eq.true&allows_rentals=eq.true&closure_due_time=not.is.null&select=id,name,closure_due_time,closure_grace_minutes,operating_days");
  for (const kiosk of kiosks || []) {
    if (!(kiosk.operating_days || []).map(Number).includes(isoDay)) continue;
    const [hours, minutes] = String(kiosk.closure_due_time).slice(0, 5).split(":").map(Number);
    const due = hours * 60 + minutes + Number(kiosk.closure_grace_minutes || 0);
    const [nowHours, nowMinutes] = localTime.split(":").map(Number);
    if (nowHours * 60 + nowMinutes < due) continue;
    const submitted = await db(ctx, `daily_closures?report_date=eq.${q(localDate)}&kiosk_id=eq.${q(kiosk.id)}&status=eq.Submetido&select=id&limit=1`);
    if (!submitted.length) await insertJob({
      event_type: "closure_missing", dedupe_key: `closure-missing:${kiosk.id}:${localDate}`,
      entity_id: kiosk.id, recipient_group: "admin", payload: { kiosk_name: kiosk.name, report_date: localDate },
    });
  }
  const result = await flushEmailOutbox(ctx);
  return { queued, processed: result.processed };
}

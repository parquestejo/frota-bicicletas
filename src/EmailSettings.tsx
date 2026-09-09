import { useEffect, useState } from "react";
import { api, patch, post } from "./api";
import { useFeedback } from "./Feedback";

type Settings = { enabled: boolean; admin_recipients: string[]; maintenance_recipients: string[]; weekly_day: number; weekly_time: string };
type KioskSchedule = { id: string; name: string; closure_due_time?: string; closure_grace_minutes: number; operating_days: number[] };
type Data = { settings: Settings; kiosks: KioskSchedule[]; jobs: any[]; readiness: Record<string, boolean> };
const days = [[1,"Seg"],[2,"Ter"],[3,"Qua"],[4,"Qui"],[5,"Sex"],[6,"Sáb"],[7,"Dom"]] as const;
const splitEmails = (value: string) => value.split(/[\n,;]/).map((item) => item.trim()).filter(Boolean);

export function EmailSettings() {
  const { notify } = useFeedback();
  const [data, setData] = useState<Data | null>(null), [admins, setAdmins] = useState(""), [maintenance, setMaintenance] = useState(""), [busy, setBusy] = useState(false);
  async function load() {
    const result = await api<Data>("/email-settings");
    setData(result); setAdmins((result.settings.admin_recipients || []).join("\n")); setMaintenance((result.settings.maintenance_recipients || []).join("\n"));
  }
  useEffect(() => { load().catch((e) => notify(e.message, "error")); }, []);
  if (!data) return <p>A carregar…</p>;
  const currentData = data;
  async function save() {
    setBusy(true);
    try {
      await patch("/email-settings", { ...currentData.settings, weekly_time: currentData.settings.weekly_time.slice(0,5), admin_recipients: splitEmails(admins), maintenance_recipients: splitEmails(maintenance) });
      await load(); notify("Configuração de emails guardada.", "success");
    } catch (e) { notify((e as Error).message, "error"); } finally { setBusy(false); }
  }
  async function saveKiosk(kiosk: KioskSchedule) {
    try { await patch(`/email-settings/kiosks/${kiosk.id}`, { ...kiosk, closure_due_time: kiosk.closure_due_time?.slice(0,5) || null }); await load(); notify(`Horário de ${kiosk.name} guardado.`, "success"); }
    catch (e) { notify((e as Error).message, "error"); }
  }
  return <>
    <div className="title"><div><h1>Emails automáticos</h1><p>Avisos operacionais e resumo semanal</p></div></div>
    <section className="card">
      <h2>Estado da integração</h2>
      <div className="readiness-grid">
        {[['resend_api_key','Chave Resend'],['sender','Remetente'],['job_secret','Chave da tarefa'],['app_url','Endereço da aplicação']].map(([key,label]) => <span key={key} className={`badge ${data.readiness[key] ? 's-resolvida':'s-aberta'}`}>{label}: {data.readiness[key] ? 'Configurado':'Em falta'}</span>)}
      </div>
      <label className="toggle-row"><input type="checkbox" checked={data.settings.enabled} onChange={(e) => setData({ ...data, settings: { ...data.settings, enabled: e.target.checked } })} /> Ativar emails automáticos</label>
      <div className="grid2">
        <label>Administração<textarea value={admins} onChange={(e) => setAdmins(e.target.value)} placeholder="um.email@dominio.pt por linha" /></label>
        <label>Manutenção<textarea value={maintenance} onChange={(e) => setMaintenance(e.target.value)} placeholder="um.email@dominio.pt por linha" /></label>
      </div>
      <div className="form-grid">
        <label>Dia do resumo semanal<select value={data.settings.weekly_day} onChange={(e) => setData({ ...data, settings: { ...data.settings, weekly_day: Number(e.target.value) } })}>{days.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>Hora do resumo<input type="time" value={data.settings.weekly_time.slice(0,5)} onChange={(e) => setData({ ...data, settings: { ...data.settings, weekly_time: e.target.value } })} /></label>
      </div>
      <div className="actions"><button className="primary" disabled={busy} onClick={save}>Guardar configuração</button><button className="secondary" disabled={busy || !data.settings.enabled} onClick={async () => { try { await post("/email-settings/test", {}); notify("Email de teste colocado na fila.", "success"); setTimeout(() => load(), 1200); } catch (e) { notify((e as Error).message, "error"); } }}>Enviar teste</button></div>
    </section>
    <section className="card"><h2>Fechos em falta</h2><p className="muted">O aviso é gerado depois da hora-limite e da tolerância, nos dias selecionados.</p>
      {data.kiosks.map((kiosk) => <div className="schedule-row" key={kiosk.id}><b>{kiosk.name}</b><label>Hora-limite<input type="time" value={kiosk.closure_due_time?.slice(0,5) || ""} onChange={(e) => setData({ ...data, kiosks: data.kiosks.map((x) => x.id === kiosk.id ? { ...x, closure_due_time: e.target.value } : x) })} /></label><label>Tolerância (min)<input type="number" min="0" max="240" value={kiosk.closure_grace_minutes} onChange={(e) => setData({ ...data, kiosks: data.kiosks.map((x) => x.id === kiosk.id ? { ...x, closure_grace_minutes: Number(e.target.value) } : x) })} /></label><fieldset className="weekday-set"><legend>Dias</legend>{days.map(([day,label]) => <label key={day}><input type="checkbox" checked={(kiosk.operating_days || []).includes(day)} onChange={(e) => setData({ ...data, kiosks: data.kiosks.map((x) => x.id === kiosk.id ? { ...x, operating_days: e.target.checked ? [...x.operating_days, day].sort() : x.operating_days.filter((d) => d !== day) } : x) })} />{label}</label>)}</fieldset><button className="secondary" onClick={() => saveKiosk(kiosk)}>Guardar</button></div>)}
    </section>
    <section className="card"><h2>Envios recentes</h2><div className="table-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th>Estado</th><th>Tentativas</th><th>Erro</th></tr></thead><tbody>{data.jobs.map((job) => <tr key={job.id}><td>{new Date(job.created_at).toLocaleString('pt-PT')}</td><td>{job.event_type}</td><td>{job.status}</td><td>{job.attempts}</td><td>{job.last_error || '—'}</td></tr>)}</tbody></table></div></section>
  </>;
}

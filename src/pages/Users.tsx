import { useState } from "react";
import { patch, post } from "../api";
import type { Kiosk, User } from "../types";
import { useFeedback } from "../Feedback";
import { fmt, useLoad } from "./shared";

type PasswordFieldsProps = {
  busy: boolean;
  onCancel: () => void;
  onSave: (password: string) => Promise<void>;
};
function PasswordFields({ busy, onCancel, onSave }: PasswordFieldsProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const mismatch = !!confirmation && password !== confirmation;
  return <div className="inline-form password-reset-form">
    <label>Nova palavra-passe<input type="password" minLength={6} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <label>Repetir palavra-passe<input type="password" minLength={6} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
    {mismatch && <p className="error" role="alert">As palavras-passe não são iguais.</p>}
    <div className="actions">
      <button type="button" className="primary" disabled={busy || password.length < 6 || mismatch || !confirmation} onClick={() => onSave(password)}>{busy ? "A guardar…" : "Guardar palavra-passe"}</button>
      <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancelar</button>
    </div>
  </div>;
}

function UserAdminControls({ user, kiosks, onSaved }: { user: User; kiosks: Kiosk[]; onSaved: () => void }) {
  const { notify } = useFeedback();
  const [open, setOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState(user.full_name);
  const [username, setUsername] = useState(user.username);
  const [role, setRole] = useState(user.role);
  const [kiosk, setKiosk] = useState(user.usual_kiosk_id || "");
  const [active, setActive] = useState(user.active);
  const [busy, setBusy] = useState(false);
  async function saveUser() {
    setBusy(true);
    try {
      await patch("/users/" + user.id, { full_name: fullName, username, role, usual_kiosk_id: kiosk || null, active });
      setOpen(false);
      notify("Utilizador atualizado.", "success");
      onSaved();
    } catch (reason) {
      notify((reason as Error).message, "error");
    } finally { setBusy(false); }
  }
  async function savePassword(password: string) {
    setBusy(true);
    try {
      await post("/users/" + user.id + "/password", { password });
      setShowPassword(false);
      notify("Palavra-passe alterada.", "success");
    } catch (reason) {
      notify((reason as Error).message, "error");
    } finally { setBusy(false); }
  }
  return <div className="user-controls">
    <button type="button" className="text" onClick={() => setOpen(!open)}>{open ? "Fechar" : "Editar"}</button>
    {open && <div className="user-edit-panel">
      <h3>Editar utilizador</h3>
      <label>Nome completo<input value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
      <label>Nome de utilizador<input autoCapitalize="none" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} /><small>Letras, números, ponto, hífen ou sublinhado.</small></label>
      <label>Perfil<select value={role} onChange={(event) => setRole(event.target.value as User["role"])}><option value="funcionario">Funcionário</option><option value="manutencao">Manutenção</option><option value="admin">Administrador</option></select></label>
      <label>Quiosque habitual<select value={kiosk} onChange={(event) => setKiosk(event.target.value)}><option value="">Sem quiosque definido</option>{kiosks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="check"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Conta ativa</label>
      <button type="button" className="primary full" disabled={busy || !fullName.trim() || !username.trim()} onClick={saveUser}>{busy ? "A guardar…" : "Guardar alterações"}</button>
      {!showPassword && <button type="button" className="secondary full" onClick={() => setShowPassword(true)}>Redefinir palavra-passe</button>}
      {showPassword && <PasswordFields busy={busy} onCancel={() => setShowPassword(false)} onSave={savePassword} />}
    </div>}
  </div>;
}

export function Users() {
  const { notify } = useFeedback();
  const [refresh, setRefresh] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ full_name: "", username: "", password: "", confirmation: "", role: "funcionario" as User["role"], usual_kiosk_id: "" });
  const { data, error } = useLoad<{ users: User[]; kiosks: Kiosk[] }>("/users", refresh);
  const mismatch = !!form.confirmation && form.password !== form.confirmation;
  async function add() {
    setBusy(true);
    try {
      await post("/users", { full_name: form.full_name, username: form.username, password: form.password, role: form.role, usual_kiosk_id: form.usual_kiosk_id || null });
      setForm({ full_name: "", username: "", password: "", confirmation: "", role: "funcionario", usual_kiosk_id: "" });
      setShowCreate(false);
      setRefresh((value) => value + 1);
      notify("Utilizador criado.", "success");
    } catch (reason) {
      notify((reason as Error).message, "error");
    } finally { setBusy(false); }
  }
  return <>
    <div className="title"><div><h1>Utilizadores</h1><p>Contas e permissões</p></div><button type="button" className="primary" onClick={() => setShowCreate(!showCreate)}>{showCreate ? "Cancelar" : "Criar utilizador"}</button></div>
    {showCreate && <section className="card form compact-form user-create-form">
      <h2>Novo utilizador</h2>
      <div className="form-grid">
        <label>Nome completo<input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></label>
        <label>Nome de utilizador<input autoCapitalize="none" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase() })} /></label>
        <label>Perfil<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as User["role"] })}><option value="funcionario">Funcionário</option><option value="manutencao">Manutenção</option><option value="admin">Administrador</option></select></label>
        <label>Quiosque habitual<select value={form.usual_kiosk_id} onChange={(event) => setForm({ ...form, usual_kiosk_id: event.target.value })}><option value="">Sem quiosque definido</option>{data?.kiosks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Palavra-passe inicial<input type="password" minLength={6} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
        <label>Repetir palavra-passe<input type="password" minLength={6} autoComplete="new-password" value={form.confirmation} onChange={(event) => setForm({ ...form, confirmation: event.target.value })} /></label>
      </div>
      {mismatch && <p className="error" role="alert">As palavras-passe não são iguais.</p>}
      <button type="button" className="primary" disabled={busy || !form.full_name.trim() || !form.username.trim() || form.password.length < 6 || !form.confirmation || mismatch} onClick={add}>{busy ? "A criar…" : "Criar utilizador"}</button>
    </section>}
    {error && <p className="error">{error}</p>}
    <div className="table-wrap"><table><thead><tr><th>Nome</th><th>Utilizador</th><th>Perfil</th><th>Quiosque habitual</th><th>Estado</th><th>Último acesso</th><th>Ações</th></tr></thead><tbody>
      {data?.users.map((item) => <tr key={item.id}><td>{item.full_name}</td><td>{item.username}</td><td>{item.role === "admin" ? "Administrador" : item.role === "manutencao" ? "Manutenção" : "Funcionário"}</td><td>{data.kiosks.find((kiosk) => kiosk.id === item.usual_kiosk_id)?.name || "—"}</td><td>{item.active ? "Ativo" : "Inativo"}</td><td>{fmt(item.last_login_at)}</td><td><UserAdminControls user={item} kiosks={data.kiosks} onSaved={() => setRefresh((value) => value + 1)} /></td></tr>)}
    </tbody></table></div>
  </>;
}

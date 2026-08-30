import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, patch, post } from "./api";
import type { User } from "./types";
import { useFeedback } from "./Feedback";

type FaultNotification = {
  id: string;
  fault_id: string;
  title: string;
  message: string;
  created_at: string;
  read_at?: string | null;
  fault?: { id: string; status: string; severity: string; bike?: { code: string; kiosk?: { name: string } } };
};

const formatDate = (value: string) => new Intl.DateTimeFormat("pt-PT", {
  dateStyle: "short", timeStyle: "short", timeZone: "Europe/Lisbon",
}).format(new Date(value));

export function NotificationCenter({ user }: { user: User }) {
  const enabled = ["admin", "manutencao"].includes(user.role);
  const navigate = useNavigate();
  const { notify } = useFeedback();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FaultNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const result = await api<{ notifications: FaultNotification[]; unread: number }>("/notifications");
      setItems(result.notifications);
      setUnread(result.unread);
    } catch {
      // Uma falha momentânea no polling não deve interromper o trabalho.
    }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    load();
    const timer = window.setInterval(load, 60000);
    window.addEventListener("focus", load);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, [enabled, load]);
  if (!enabled) return null;
  async function openNotification(item: FaultNotification) {
    try {
      if (!item.read_at) await patch(`/notifications/${item.id}/read`, {});
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry));
      setUnread((value) => Math.max(0, value - (item.read_at ? 0 : 1)));
      setOpen(false);
      navigate(`/avarias?focus=${encodeURIComponent(item.fault_id)}`);
    } catch (reason) { notify((reason as Error).message, "error"); }
  }
  async function readAll() {
    try {
      await post("/notifications/read-all", {});
      setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })));
      setUnread(0);
    } catch (reason) { notify((reason as Error).message, "error"); }
  }
  return <div className="notification-center">
    <button type="button" className="notification-button" aria-label={`${unread} notificações não lidas`} aria-expanded={open} onClick={() => setOpen(!open)}>
      <span aria-hidden="true">🔔</span>{unread > 0 && <b>{unread > 99 ? "99+" : unread}</b>}
    </button>
    {open && <section className="notification-panel" aria-label="Notificações de avarias">
      <div className="notification-heading"><div><h2>Notificações</h2><small>Avarias comunicadas</small></div>{unread > 0 && <button type="button" className="text" onClick={readAll}>Marcar todas como lidas</button>}</div>
      <div className="notification-list">
        {items.length ? items.map((item) => <button type="button" className={`notification-item ${item.read_at ? "" : "unread"}`} key={item.id} onClick={() => openNotification(item)}>
          <span><b>{item.title}</b><small>{item.message}</small><time>{formatDate(item.created_at)}</time></span>
        </button>) : <p className="muted notification-empty">Sem notificações.</p>}
      </div>
    </section>}
  </div>;
}

import { useEffect, useMemo, useState } from "react";
import type { RentalNetworkAnalytics } from "../reportPdf";
import { DateRange, useLoad } from "./shared";

type Stock = {
  id: string;
  name: string;
  available: number;
  rented: number;
  unavailable: number;
  total: number;
  gap_to_minimum: number;
  status: "critical" | "warning" | "ok";
  by_type: { code: string; name: string; available: number }[];
};

type LogisticsData = {
  generated_at: string;
  minimum_stock: number;
  stock: Stock[];
  network: RentalNetworkAnalytics;
};

type Transfer = { from: string; to: string; quantity: number };

const dateKey = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon" }).format(date);

function suggestedTransfers(stock: Stock[], minimum: number): Transfer[] {
  if (stock.length < 2) return [];
  const total = stock.reduce((sum, kiosk) => sum + kiosk.available, 0);
  const target = Math.max(minimum, Math.floor(total / stock.length));
  const donors = stock
    .map((item) => ({ ...item, spare: Math.max(0, item.available - Math.max(minimum, target)) }))
    .filter((item) => item.spare > 0)
    .sort((a, b) => b.spare - a.spare);
  const receivers = stock
    .map((item) => ({ ...item, need: Math.max(0, target - item.available) }))
    .filter((item) => item.need > 0)
    .sort((a, b) => b.need - a.need);
  const transfers: Transfer[] = [];
  for (const receiver of receivers) {
    for (const donor of donors) {
      if (!receiver.need) break;
      const quantity = Math.min(receiver.need, donor.spare);
      if (!quantity) continue;
      transfers.push({ from: donor.name, to: receiver.name, quantity });
      donor.spare -= quantity;
      receiver.need -= quantity;
    }
  }
  return transfers;
}

export function Logistics() {
  const today = dateKey(new Date());
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6);
  const [from, setFrom] = useState(dateKey(weekAgo));
  const [to, setTo] = useState(today);
  const [refresh, setRefresh] = useState(0);
  const path = useMemo(() => `/logistics/balance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, [from, to]);
  const { data, error } = useLoad<LogisticsData>(path, refresh);
  useEffect(() => {
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 60000);
    return () => window.clearInterval(timer);
  }, []);

  if (error) return <p className="error">Não foi possível carregar o balanceamento: {error}</p>;
  if (!data) return <p>A calcular o saldo da rede…</p>;

  const transfers = suggestedTransfers(data.stock, data.minimum_stock);
  const critical = data.stock.filter((item) => item.status === "critical");
  const warning = data.stock.filter((item) => item.status === "warning");
  const available = data.stock.reduce((sum, item) => sum + item.available, 0);
  const statusLabel = critical.length ? "Intervenção imediata" : warning.length ? "Reequilíbrio necessário" : "Rede equilibrada";

  return <>
    <div className="title logistics-heading">
      <div><h1>Logística e balanceamento</h1><p>Disponibilidade atual e movimentos de bicicletas entre quiosques.</p></div>
      <div className="logistics-refresh"><small>Atualizado às {new Date(data.generated_at).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" })}</small><button className="secondary" onClick={() => setRefresh((value) => value + 1)}>Atualizar agora</button></div>
    </div>

    <section className={`card logistics-alert logistics-${critical.length ? "critical" : warning.length ? "warning" : "ok"}`}>
      <div><span className="logistics-kicker">Estado da rede</span><h2>{statusLabel}</h2><p>{critical.length ? `${critical.map((item) => item.name).join(", ")} sem bicicletas disponíveis.` : warning.length ? `${warning.map((item) => item.name).join(", ")} abaixo do limite operacional de ${data.minimum_stock}.` : `Todos os quiosques têm pelo menos ${data.minimum_stock} bicicletas disponíveis.`}</p></div>
      <strong>{available}<small> disponíveis na rede</small></strong>
    </section>

    <div className="logistics-stock-grid">
      {data.stock.map((item) => <section className={`card logistics-kiosk logistics-${item.status}`} key={item.id}>
        <div className="logistics-kiosk-title"><div><span className="logistics-status-dot"/><h2>{item.name}</h2></div><span>{item.status === "critical" ? "Crítico" : item.status === "warning" ? "Atenção" : "Normal"}</span></div>
        <div className="logistics-main-number"><b>{item.available}</b><span>bicicletas<br/>disponíveis</span></div>
        <div className="logistics-type-list">{item.by_type.map((type) => <div key={type.code}><span>{type.name}</span><b>{type.available}</b></div>)}</div>
        <div className="logistics-secondary-numbers"><span>Alugadas <b>{item.rented}</b></span><span>Indisponíveis <b>{item.unavailable}</b></span><span>Total <b>{item.total}</b></span></div>
      </section>)}
    </div>

    <section className="card">
      <div className="title compact-title"><div><h2>Ação recomendada</h2><p>Transferências calculadas sem deixar o quiosque de origem abaixo do limite operacional.</p></div></div>
      {transfers.length ? <div className="logistics-actions">{transfers.map((transfer, index) => <div className="logistics-transfer" key={`${transfer.from}-${transfer.to}-${index}`}><b>{transfer.quantity}</b><span>{transfer.quantity === 1 ? "bicicleta" : "bicicletas"}</span><strong>{transfer.from} → {transfer.to}</strong></div>)}</div> : critical.length || warning.length ? <p className="error">Não existe neste momento excedente suficiente noutro quiosque para corrigir o desequilíbrio. É necessário recorrer ao armazém ou aguardar devoluções.</p> : <p className="success">Não é necessária qualquer transferência neste momento.</p>}
    </section>

    <section className="card">
      <div className="title report-title"><div><h2>Movimentos entre quiosques</h2><p>Entregas noutro quiosque no período selecionado.</p></div><strong>{data.network.cross_kiosk_rental_count} alugueres em rede · {Number(data.network.cross_kiosk_percentage || 0).toLocaleString("pt-PT")}%</strong></div>
      <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo}/>
      <div className="grid2 analytics-grid">
        <div><h3>Saldo por quiosque</h3><div className="table-wrap"><table><thead><tr><th>Quiosque</th><th>Saíram</th><th>Entraram</th><th>Saldo</th><th>Disponíveis</th></tr></thead><tbody>{data.network.balances.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.network_out}</td><td>{item.network_in}</td><td><b>{item.net_change > 0 ? `+${item.net_change}` : item.net_change}</b></td><td><b>{item.current_available}</b></td></tr>)}</tbody></table></div></div>
        <div><h3>Percursos</h3><div className="table-wrap"><table><thead><tr><th>Percurso</th><th>Bicicletas</th></tr></thead><tbody>{data.network.routes.slice(0, 8).map((item) => <tr key={`${item.origin_id}-${item.destination_id}`}><td>{item.origin_name} → {item.destination_name}</td><td><b>{item.bicycle_count}</b></td></tr>)}{!data.network.routes.length && <tr><td colSpan={2} className="muted">Sem movimentos no período.</td></tr>}</tbody></table></div></div>
      </div>
    </section>
  </>;
}

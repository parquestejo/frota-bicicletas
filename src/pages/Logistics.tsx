import { useEffect, useMemo, useState } from "react";
import type { RentalNetworkAnalytics } from "../reportPdf";
import { DateRange, useLoad } from "./shared";
import { suggestedTypeTransfers } from "../domain";

type Stock = {
  id: string;
  name: string;
  available: number;
  rented: number;
  unavailable: number;
  total: number;
  gap_to_minimum: number;
  status: "critical" | "warning" | "ok";
  by_type: { code: string; name: string; available: number; minimum: number }[];
};

type LogisticsData = {
  generated_at: string;
  minimum_stock: number;
  stock: Stock[];
  network: RentalNetworkAnalytics;
};

const dateKey = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon" }).format(date);

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

  const transfers = suggestedTypeTransfers(data.stock);
  const critical = data.stock.filter((item) => item.status === "critical");
  const warning = data.stock.filter((item) => item.status === "warning");
  const ruptures = data.stock.flatMap((item) => item.by_type.filter((type) => type.available === 0).map((type) => `${type.name} em ${item.name}`));
  const shortages = data.stock.flatMap((item) => item.by_type.filter((type) => type.available > 0 && type.available < type.minimum).map((type) => `${type.name} em ${item.name}`));
  const available = data.stock.reduce((sum, item) => sum + item.available, 0);
  const statusLabel = critical.length ? "Rutura de tipologia" : warning.length ? "Reequilíbrio necessário" : "Rede equilibrada";

  return <>
    <div className="title logistics-heading">
      <div><h1>Logística e balanceamento</h1><p>Disponibilidade atual e movimentos de bicicletas entre quiosques.</p></div>
      <div className="logistics-refresh"><small>Atualizado às {new Date(data.generated_at).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" })}</small><button className="secondary" onClick={() => setRefresh((value) => value + 1)}>Atualizar agora</button></div>
    </div>

    <section className={`card logistics-alert logistics-${critical.length ? "critical" : warning.length ? "warning" : "ok"}`}>
      <div><span className="logistics-kicker">Estado da rede</span><h2>{statusLabel}</h2><p>{critical.length ? `Sem ${ruptures.join("; sem ")}.` : warning.length ? `${shortages.length ? shortages.join("; ") : warning.map((item) => item.name).join(", ")} abaixo do nível operacional.` : "Todos os quiosques têm disponibilidade mínima em cada tipologia."}</p></div>
      <strong>{available}<small> disponíveis na rede</small></strong>
    </section>

    <div className="logistics-stock-grid">
      {data.stock.map((item) => <section className={`card logistics-kiosk logistics-${item.status}`} key={item.id}>
        <div className="logistics-kiosk-title"><div><span className="logistics-status-dot"/><h2>{item.name}</h2></div><span>{item.status === "critical" ? "Crítico" : item.status === "warning" ? "Atenção" : "Normal"}</span></div>
        <div className="logistics-main-number"><b>{item.available}</b><span>bicicletas<br/>disponíveis</span></div>
        <div className="logistics-type-list">{item.by_type.map((type) => <div className={type.available === 0 ? "type-critical" : type.available < type.minimum ? "type-warning" : ""} key={type.code}><span>{type.name}</span><b>{type.available}{type.available === 0 && <small> Rutura</small>}</b></div>)}</div>
        <div className="logistics-secondary-numbers"><span>Alugadas <b>{item.rented}</b></span><span>Indisponíveis <b>{item.unavailable}</b></span><span>Total <b>{item.total}</b></span></div>
      </section>)}
    </div>

    <section className="card">
      <div className="title compact-title"><div><h2>Ação recomendada</h2><p>Transferências por tipologia, sem criar uma nova rutura no quiosque de origem.</p></div></div>
      {transfers.length ? <div className="logistics-actions">{transfers.map((transfer, index) => <div className="logistics-transfer" key={`${transfer.typeCode}-${transfer.from}-${transfer.to}-${index}`}><b>{transfer.quantity}</b><span>{transfer.typeName}</span><strong>{transfer.from} → {transfer.to}</strong></div>)}</div> : critical.length || warning.length ? <p className="error">Não existe excedente suficiente da tipologia em falta. É necessário recorrer ao armazém ou aguardar devoluções.</p> : <p className="success">Não é necessária qualquer transferência neste momento.</p>}
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

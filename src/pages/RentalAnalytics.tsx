import { useMemo, useState } from "react";
import { exportCSV, fmt, useLoad } from "./shared";
import type { RentalAnalyticsReport } from "../reportPdf";

type Analytics = RentalAnalyticsReport;
const money = (value: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(value || 0));
const duration = (raw: number) => {
  const minutes = Math.max(0, Math.round(Number(raw || 0)));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return `${hours} h${remainder ? ` ${remainder} min` : ""}`;
};
const assetNames: Record<string, string> = {
  electric: "Bicicletas elétricas", conventional: "Bicicletas convencionais",
  child: "Bicicletas infantis", helmet: "Capacetes", lock: "Cadeados", stroller: "Carrinhos de bebé",
};

export function RentalAnalytics({ from, to }: { from: string; to: string }) {
  const path = useMemo(() => `/reports/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, [from, to]);
  const { data, error } = useLoad<{ analytics: Analytics }>(path);
  const [pdfBusy, setPdfBusy] = useState(false);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <section className="card"><p>A calcular indicadores…</p></section>;
  const report = data.analytics;
  return <section className="rental-analytics">
    <div className="title report-title">
      <div><h2>Informação de gestão</h2><p>Procura, utilização, receita e períodos sem disponibilidade.</p></div>
      <div className="report-actions">
        <button className="primary" disabled={pdfBusy} onClick={async () => {
          setPdfBusy(true);
          try {
            const { exportRentalAnalyticsPdf } = await import("../reportPdf");
            await exportRentalAnalyticsPdf(report, from, to);
          }
          finally { setPdfBusy(false); }
        }}>{pdfBusy ? "A preparar PDF…" : "Exportar relatório (PDF)"}</button>
        <button className="secondary" onClick={() => exportCSV("resumo-gestao-alugueres.csv", ["Indicador", "Valor"], [
          ["Alugueres", report.rental_count], ["Itens alugados", report.item_count], ["Receita Multibanco", Number(report.revenue).toFixed(2)],
          ["Alugueres pagos", report.paid_rental_count], ["Alugueres gratuitos", report.free_rental_count],
          ["Histórico sem classificação de valor", report.unclassified_rental_count],
          ["Duração média", duration(report.average_duration_minutes)], ["Dia da semana com maior procura", report.busiest_weekday],
          ["Dias sem bicicletas disponíveis", report.stockout_days], ["Tempo sem disponibilidade", duration(report.stockout_minutes)],
        ])}>Exportar dados (CSV)</button>
      </div>
    </div>
    <div className="fleet-kpis analytics-kpis">
      <div className="card"><span>Alugueres</span><b>{report.rental_count}</b></div>
      <div className="card"><span>Itens alugados</span><b>{report.item_count}</b></div>
      <div className="card"><span>Receita Multibanco</span><b>{money(report.revenue)}</b></div>
      <div className="card"><span>Alugueres pagos</span><b>{report.paid_rental_count}</b></div>
      <div className="card"><span>Alugueres gratuitos</span><b>{report.free_rental_count}</b></div>
      <div className="card"><span>Duração média</span><b>{duration(report.average_duration_minutes)}</b></div>
      <div className="card"><span>Dia com maior procura</span><b className="textual-kpi">{report.busiest_weekday}</b></div>
      <div className="card alert-kpi"><span>Dias sem bicicletas</span><b>{report.stockout_days}</b><small>{duration(report.stockout_minutes)} no total</small></div>
    </div>
    <div className="grid2 analytics-grid">
      <section className="card"><h3>Dias com maior procura</h3><div className="table-wrap"><table><thead><tr><th>Data</th><th>Alugueres</th><th>Itens</th><th>Receita</th></tr></thead><tbody>
        {report.busiest_days.map((day) => <tr key={day.local_date}><td>{new Intl.DateTimeFormat("pt-PT").format(new Date(`${day.local_date}T12:00:00`))}</td><td>{day.rental_count}</td><td>{day.item_count}</td><td>{money(day.revenue)}</td></tr>)}
      </tbody></table></div></section>
      <section className="card"><h3>Procura por dia da semana</h3>{report.weekdays.map((day) => <div className="row" key={day.weekday_number}><span>{day.weekday}</span><b>{day.rental_count}</b></div>)}</section>
      <section className="card"><h3>Por quiosque</h3>{report.kiosks.map((kiosk) => <div className="row" key={kiosk.id}><span>{kiosk.name}<small>{money(kiosk.revenue)}</small></span><b>{kiosk.rental_count}</b></div>)}</section>
      <section className="card"><h3>Itens mais procurados</h3>{report.asset_types.length ? report.asset_types.map((item) => <div className="row" key={item.asset_type}><span>{assetNames[item.asset_type] || item.asset_type}</span><b>{item.item_count}</b></div>) : <p className="muted">Sem alugueres no período.</p>}</section>
    </div>
    <section className="card stockout-report">
      <h3>Períodos sem bicicletas disponíveis</h3>
      <p className="muted">Registados automaticamente a partir da instalação desta funcionalidade. “Capacidade mista” significa que existiam bicicletas alugadas e outras fora de serviço.</p>
      <div className="table-wrap"><table><thead><tr><th>Quiosque</th><th>Início</th><th>Fim</th><th>Duração</th><th>Alugadas</th><th>Fora de serviço</th><th>Causa</th></tr></thead><tbody>
        {report.stockouts.map((incident) => <tr key={incident.id}><td>{incident.kiosk_name}</td><td>{fmt(incident.started_at)}</td><td>{incident.ended_at ? fmt(incident.ended_at) : "Em curso"}</td><td>{duration(incident.duration_minutes)}</td><td>{incident.rented_count}</td><td>{incident.out_of_service_count}</td><td>{incident.cause}</td></tr>)}
        {!report.stockouts.length && <tr><td colSpan={7} className="muted">Não foram registados períodos sem disponibilidade.</td></tr>}
      </tbody></table></div>
    </section>
  </section>;
}

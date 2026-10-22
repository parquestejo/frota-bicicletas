import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, post, patch } from "../api";
import type { AssetType, Bike, BikeStatus, Fault, Kiosk, Rental, RentalDiscrepancy, RentalItem, User } from "../types";
import { useFeedback } from "../Feedback";
import { assetLabel, assetOptions, assetTypeOf, Badge, DateRange, daysSince, dayKey, exportCSV, fmt, inDateRange, isBicycle, operationalStatuses, statuses, useLoad } from "./shared";
import { RentalAnalytics } from "./RentalAnalytics";
export function Reports() {
  const [tab, setTab] = useState<"rentals" | "faults">("rentals"),
    [dateFrom, setDateFrom] = useState(""),
    [dateTo, setDateTo] = useState(""),[page,setPage]=useState(1),[exportBusy,setExportBusy]=useState(false);
  const reportPath=useMemo(()=>`/reports/data?kind=${tab}&from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}&page=${page}&page_size=50`,[tab,dateFrom,dateTo,page]);
  const reportsLoad = useLoad<{ rentals?: Rental[]; faults?: Fault[];total:number;page_size:number }>(reportPath);
  const rentals = reportsLoad.data?.rentals || [],faults = reportsLoad.data?.faults || [],total=reportsLoad.data?.total||0,pages=Math.max(1,Math.ceil(total/(reportsLoad.data?.page_size||50)));
  const rentalRowsFor = (list:Rental[]) => list.flatMap((r) =>
    r.items.map((i) => [
      r.reference,
      r.customer_ref,
      r.rental_kind === "institutional" ? "Institucional" : r.rental_kind === "resident" ? "Residente" : r.rental_kind === "frequent" ? "Cliente frequente" : r.rental_kind === "school" ? "Cartão Escolar" : "Normal",
      Number(r.charged_amount || 0).toFixed(2),
      Number(r.expected_amount || 0).toFixed(2),
      Number(r.discount_amount || 0).toFixed(2),
      r.institutional_entity || "",
      r.institutional_person || "",
      i.bike?.code,
      assetLabel(i.bike),
      r.start_kiosk?.name,
      i.return_kiosk?.name,
      fmt(r.started_at),
      fmt(i.returned_at || r.returned_at),
      r.started_by_user?.full_name,
      i.returned_by_user?.full_name || r.returned_by_user?.full_name,
      i.anomaly ? "Sim" : "Não",
      i.anomaly_description || "",
      Number(i.deposit_retained || 0).toFixed(2),
      i.deposit_retention_reason || "",
      Number(r.estimated_distance_km || 0).toFixed(2),
      Number(r.estimated_co2_kg || 0).toFixed(3),
    ]),
  );
  const faultRowsFor = (list:Fault[]) => list.map((f) => [
    f.bike?.code,
    assetLabel(f.bike),
    f.origin,
    f.category,
    f.description,
    f.severity,
    f.usable ? "Sim" : "Não",
    f.status,
    fmt(f.created_at),
    f.created_by_user?.full_name,
    f.notes || "",
  ]);
  async function exportAll(){
    setExportBusy(true);
    try{
      const result=await api<{rentals?:Rental[];faults?:Fault[]}>(`/reports/data?kind=${tab}&from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}&all=1`);
      if(tab==="rentals")exportCSV("alugueres-concluidos.csv",["Referência","Cliente","Tipo de utilização","Valor Multibanco (€)","Valor comercial (€)","Benefício/desconto (€)","Entidade institucional","Pessoa que levantou","Item","Tipo","Quiosque de saída","Quiosque de devolução","Início","Devolução","Registado por","Devolvido por","Anomalia","Descrição da anomalia","Caução retida (€)","Motivo da retenção","Distância estimada (km)","CO₂ evitado estimado (kg)"],rentalRowsFor(result.rentals||[]));
      else exportCSV("avarias.csv",["Item","Tipo","Origem","Categoria","Descrição","Gravidade","Utilizável","Estado","Data","Registado por","Notas"],faultRowsFor(result.faults||[]));
    }finally{setExportBusy(false)}
  }
  return (
    <>
      <div className="title">
        <div>
          <h1>Relatórios</h1>
          <p>Consulta detalhada e exportação de dados</p>
        </div>
      </div>
      <div className="report-tabs">
        <button
          className={tab === "rentals" ? "primary" : "secondary"}
          onClick={() => { setTab("rentals"); setPage(1); }}
        >
          Alugueres concluídos
        </button>
        <button
          className={tab === "faults" ? "primary" : "secondary"}
          onClick={() => { setTab("faults"); setPage(1); }}
        >
          Avarias
        </button>
      </div>
      <DateRange
        from={dateFrom}
        to={dateTo}
        onFrom={(value) => { setDateFrom(value); setPage(1); }}
        onTo={(value) => { setDateTo(value); setPage(1); }}
      />
      {reportsLoad.error && (
        <p className="error">{reportsLoad.error}</p>
      )}
      {tab === "rentals" ? (
        <>
          <RentalAnalytics from={dateFrom} to={dateTo} />
          <div className="title report-title">
            <div>
              <h2>Alugueres concluídos</h2>
              <p>Uma linha por item devolvido.</p>
            </div>
            <button
              className="primary"
              onClick={exportAll}
              disabled={exportBusy}
            >
              {exportBusy ? "A preparar…" : "Exportar período completo (CSV)"}
            </button>
          </div>
          <div className="table-wrap">
            <table className="wide-table">
              <thead>
                <tr>
                  <th>Referência</th>
                  <th>Cliente</th>
                  <th>Utilização</th>
                  <th>Valor</th>
                  <th>Valor comercial</th>
                  <th>Item</th>
                  <th>Tipo</th>
                  <th>Saída</th>
                  <th>Devolução</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th>Funcionários</th>
                  <th>Anomalia</th>
                  <th>CO₂ estimado</th>
                </tr>
              </thead>
              <tbody>
                {rentals.flatMap((r) =>
                  r.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <b>{r.reference}</b>
                      </td>
                      <td>{r.customer_ref}</td>
                      <td>{r.rental_kind === "institutional" ? `Institucional · ${r.institutional_entity}` : r.rental_kind === "resident" ? "Residente" : r.rental_kind === "frequent" ? "Cliente frequente" : r.rental_kind === "school" ? `Cartão Escolar · ${r.customer_profile?.school || "—"}` : "Normal"}</td>
                      <td>{new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(r.charged_amount || 0))}</td>
                      <td>{new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(r.expected_amount || 0))}</td>
                      <td>{i.bike?.code}</td>
                      <td>{assetLabel(i.bike)}</td>
                      <td>{r.start_kiosk?.name}</td>
                      <td>{i.return_kiosk?.name || "—"}</td>
                      <td>{fmt(r.started_at)}</td>
                      <td>{fmt(i.returned_at || r.returned_at)}</td>
                      <td>
                        {r.started_by_user?.full_name || "—"}
                        <br />
                        <small>
                          Devolução:{" "}
                          {i.returned_by_user?.full_name ||
                            r.returned_by_user?.full_name ||
                            "—"}
                        </small>
                      </td>
                      <td>
                        {i.anomaly ? i.anomaly_description || "Sim" : "Não"}
                      </td>
                      <td>{Number(r.estimated_co2_kg || 0).toLocaleString("pt-PT",{maximumFractionDigits:2})} kg</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="title report-title">
            <div>
              <h2>Histórico de avarias</h2>
              <p>Inclui ocorrências abertas, em tratamento e concluídas.</p>
            </div>
            <button
              className="primary"
              onClick={exportAll}
              disabled={exportBusy}
            >
              {exportBusy ? "A preparar…" : "Exportar período completo (CSV)"}
            </button>
          </div>
          <div className="table-wrap">
            <table className="wide-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Tipo</th>
                  <th>Origem</th>
                  <th>Categoria</th>
                  <th>Descrição</th>
                  <th>Gravidade</th>
                  <th>Utilizável</th>
                  <th>Estado</th>
                  <th>Data</th>
                  <th>Registado por</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {faults.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <b>{f.bike?.code}</b>
                    </td>
                    <td>{assetLabel(f.bike)}</td>
                    <td>{f.origin}</td>
                    <td>{f.category}</td>
                    <td>{f.description}</td>
                    <td>{f.severity}</td>
                    <td>{f.usable ? "Sim" : "Não"}</td>
                    <td>
                      <Badge>{f.status}</Badge>
                    </td>
                    <td>{fmt(f.created_at)}</td>
                    <td>{f.created_by_user?.full_name || "—"}</td>
                    <td>{f.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <nav className="pagination" aria-label="Paginação do relatório">
        <button className="secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button>
        <span>Página {page} de {pages} · {total} registos</span>
        <button className="secondary" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Seguinte</button>
      </nav>
    </>
  );
}

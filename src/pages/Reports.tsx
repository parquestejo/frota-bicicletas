import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, post, patch } from "../api";
import type { AssetType, Bike, BikeStatus, Fault, Kiosk, Rental, RentalDiscrepancy, RentalItem, User } from "../types";
import { useFeedback } from "../Feedback";
import { assetLabel, assetOptions, assetTypeOf, Badge, DateRange, daysSince, dayKey, exportCSV, fmt, inDateRange, isBicycle, operationalStatuses, statuses, useLoad } from "./shared";
export function Reports() {
  const reportsLoad = useLoad<{ rentals: Rental[]; faults: Fault[] }>("/reports/data");
  const [tab, setTab] = useState<"rentals" | "faults">("rentals"),
    [dateFrom, setDateFrom] = useState(""),
    [dateTo, setDateTo] = useState("");
  const rentals = (reportsLoad.data?.rentals || []).filter(
      (r) =>
        r.status === "Concluído" && inDateRange(r.started_at, dateFrom, dateTo),
    ),
    faults = (reportsLoad.data?.faults || []).filter((f) =>
      inDateRange(f.created_at, dateFrom, dateTo),
    );
  const rentalRows = rentals.flatMap((r) =>
    r.items.map((i) => [
      r.reference,
      r.customer_ref,
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
    ]),
  );
  const faultRows = faults.map((f) => [
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
          onClick={() => setTab("rentals")}
        >
          Alugueres concluídos ({rentals.length})
        </button>
        <button
          className={tab === "faults" ? "primary" : "secondary"}
          onClick={() => setTab("faults")}
        >
          Avarias ({faults.length})
        </button>
      </div>
      <DateRange
        from={dateFrom}
        to={dateTo}
        onFrom={setDateFrom}
        onTo={setDateTo}
      />
      {reportsLoad.error && (
        <p className="error">{reportsLoad.error}</p>
      )}
      {tab === "rentals" ? (
        <>
          <div className="title report-title">
            <div>
              <h2>Alugueres concluídos</h2>
              <p>Uma linha por item devolvido.</p>
            </div>
            <button
              className="primary"
              onClick={() =>
                exportCSV(
                  "alugueres-concluidos.csv",
                  [
                    "Referência",
                    "Cliente",
                    "Item",
                    "Tipo",
                    "Quiosque de saída",
                    "Quiosque de devolução",
                    "Início",
                    "Devolução",
                    "Registado por",
                    "Devolvido por",
                    "Anomalia",
                    "Descrição da anomalia",
                  ],
                  rentalRows,
                )
              }
            >
              Exportar para Excel (CSV)
            </button>
          </div>
          <div className="table-wrap">
            <table className="wide-table">
              <thead>
                <tr>
                  <th>Referência</th>
                  <th>Cliente</th>
                  <th>Item</th>
                  <th>Tipo</th>
                  <th>Saída</th>
                  <th>Devolução</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th>Funcionários</th>
                  <th>Anomalia</th>
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
              onClick={() =>
                exportCSV(
                  "avarias.csv",
                  [
                    "Item",
                    "Tipo",
                    "Origem",
                    "Categoria",
                    "Descrição",
                    "Gravidade",
                    "Utilizável",
                    "Estado",
                    "Data",
                    "Registado por",
                    "Notas",
                  ],
                  faultRows,
                )
              }
            >
              Exportar para Excel (CSV)
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
    </>
  );
}


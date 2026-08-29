import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, post, patch } from "../api";
import type { AssetType, Bike, BikeStatus, Fault, Kiosk, Rental, RentalDiscrepancy, RentalItem, User } from "../types";
import { useFeedback } from "../Feedback";
import { faultStatuses } from "./FaultReport";
import { assetLabel, assetOptions, assetTypeOf, Badge, DateRange, daysSince, dayKey, exportCSV, fmt, inDateRange, isBicycle, operationalStatuses, statuses, useLoad } from "./shared";
function MaintenanceSummary({ faults }: { faults: Fault[] }) {
  const pending = faults.filter(
      (f) => !["Resolvida", "Cancelada"].includes(f.status),
    ),
    critical = pending.filter((f) =>
      ["Alta", "Impeditiva"].includes(f.severity),
    ),
    affected = new Set(pending.map((f) => f.bike_id)).size,
    resolved = faults.filter((f) => f.status === "Resolvida").length;
  const byStatus = (status: string) => {
    const list = faults.filter((f) => f.status === status);
    return {
      total: list.length,
      bicycles: list.filter((f) => isBicycle(f.bike)).length,
      accessories: list.filter((f) => !isBicycle(f.bike)).length,
    };
  };
  return (
    <section className="fleet-summary maintenance-summary">
      <div className="fleet-kpis maintenance-kpis">
        <div className="card alert-kpi">
          <span>Ocorrências pendentes</span>
          <b>{pending.length}</b>
        </div>
        <div className="card">
          <span>Itens afetados</span>
          <b>{affected}</b>
        </div>
        <div className="card">
          <span>Em análise</span>
          <b>{faults.filter((f) => f.status === "Em análise").length}</b>
        </div>
        <div className="card">
          <span>Em reparação</span>
          <b>{faults.filter((f) => f.status === "Em reparação").length}</b>
        </div>
        <div className="card alert-kpi">
          <span>Alta ou impeditiva</span>
          <b>{critical.length}</b>
        </div>
        <div className="card">
          <span>Resolvidas</span>
          <b>{resolved}</b>
        </div>
      </div>
      <section className="card maintenance-status-summary">
        <h2>Ocorrências por estado e categoria</h2>
        <div className="summary-head">
          <span>Estado</span>
          <span>Bicicletas</span>
          <span>Acessórios</span>
          <span>Total</span>
        </div>
        {faultStatuses.map((s) => {
          const c = byStatus(s);
          return (
            <div className="summary-row" key={s}>
              <Badge>{s}</Badge>
              <span>{c.bicycles}</span>
              <span>{c.accessories}</span>
              <b>{c.total}</b>
            </div>
          );
        })}
      </section>
    </section>
  );
}
function FaultUpdateControls({
  fault,
  onSaved,
}: {
  fault: Fault;
  onSaved: () => void;
}) {
  const { notify } = useFeedback();
  const [status, setStatus] = useState(fault.status),
    [note, setNote] = useState(""),
    [finalStatus, setFinalStatus] = useState<BikeStatus>("Disponível"),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false);
  if (["Resolvida", "Cancelada"].includes(fault.status))
    return <span className="muted">Concluída</span>;
  return (
    <div className="fault-update">
      <button className="text" onClick={() => setOpen(!open)}>
        {open ? "Fechar" : "Atualizar"}
      </button>
      {open && (
        <div className="fault-update-panel">
          <label>
            Novo estado
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {faultStatuses.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          {status === "Resolvida" && (
            <label>
              Estado final do item
              <select
                value={finalStatus}
                onChange={(e) => setFinalStatus(e.target.value as BikeStatus)}
              >
                {["Disponível", "Indisponível", "Em manutenção"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Reparação ou intervenção realizada
            <textarea
              placeholder="Ex.: substituição da câmara de ar e afinação dos travões"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={busy || (status === fault.status && !note.trim())}
            onClick={async () => {
              setBusy(true);
              try {
                await patch("/faults/" + fault.id, {
                  status,
                  final_bike_status:
                    status === "Resolvida" ? finalStatus : null,
                  note: note.trim() || null,
                });
                setOpen(false);
                onSaved();
              } catch (e) {
                notify((e as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "A guardar…" : "Guardar atualização"}
          </button>
        </div>
      )}
    </div>
  );
}
export function Faults() {
  const [refresh, setRefresh] = useState(0),
    [dateFrom, setDateFrom] = useState(""),
    [dateTo, setDateTo] = useState(""),
    [show, setShow] = useState(
      new URLSearchParams(location.search).has("nova"),
    );
  const { data, error } = useLoad<{ faults: Fault[]; bikes: Bike[] }>(
    "/faults",
    refresh,
  );
  const visibleFaults = (data?.faults || []).filter((f) =>
    inDateRange(f.created_at, dateFrom, dateTo),
  );
  const [form, setForm] = useState({
    bike_id: "",
    category: "travões",
    description: "",
    severity: "Média",
    usable: false,
  });
  async function create() {
    await post("/faults", form);
    setShow(false);
    setRefresh((x) => x + 1);
  }
  return (
    <>
      <div className="title">
        <div>
          <h1>Avarias e manutenção</h1>
          <p>Ocorrências e intervenções</p>
        </div>
        <button className="primary" onClick={() => setShow(!show)}>
          Comunicar avaria
        </button>
      </div>
      <MaintenanceSummary faults={data?.faults || []} />
      <DateRange
        from={dateFrom}
        to={dateTo}
        onFrom={setDateFrom}
        onTo={setDateTo}
      />
      {show && (
        <section className="card form">
          <label>
            Item
            <select
              value={form.bike_id}
              onChange={(e) => setForm({ ...form, bike_id: e.target.value })}
            >
              <option value="">Selecionar…</option>
              {data?.bikes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} · {b.model}
                </option>
              ))}
            </select>
          </label>
          <label>
            Categoria
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {[
                "pneus ou câmaras",
                "travões",
                "mudanças",
                "corrente ou transmissão",
                "rodas",
                "selim",
                "guiador",
                "iluminação ou refletores",
                "estrutura",
                "limpeza",
                "acessórios",
                "outra",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Gravidade
            <select
              value={form.severity}
              onChange={(e) => setForm({ ...form, severity: e.target.value })}
            >
              {["Baixa", "Média", "Alta", "Impeditiva"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.usable}
              onChange={(e) => setForm({ ...form, usable: e.target.checked })}
            />{" "}
            O item ainda pode ser utilizado
          </label>
          <label>
            Descrição
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <button
            className="primary"
            disabled={!form.bike_id || !form.description}
            onClick={create}
          >
            Registar avaria
          </button>
        </section>
      )}
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table className="fault-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Categoria</th>
              <th>Gravidade</th>
              <th>Estado</th>
              <th>Descrição da avaria</th>
              <th>Reparação/notas</th>
              <th>Data</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {visibleFaults.map((f) => (
              <tr key={f.id}>
                <td>
                  <b>{f.bike?.code}</b>
                </td>
                <td>{f.category}</td>
                <td>{f.severity}</td>
                <td>
                  <Badge>{f.status}</Badge>
                </td>
                <td>{f.description}</td>
                <td>{f.notes || "—"}</td>
                <td>
                  {fmt(f.created_at)}
                  {!["Resolvida", "Cancelada"].includes(f.status) && (
                    <small className="fault-age">
                      Há {daysSince(f.created_at)}{" "}
                      {daysSince(f.created_at) === 1 ? "dia" : "dias"}
                    </small>
                  )}
                </td>
                <td>
                  <FaultUpdateControls
                    fault={f}
                    onSaved={() => setRefresh((x) => x + 1)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

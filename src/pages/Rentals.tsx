import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, post, patch } from "../api";
import type { AssetType, Bike, BikeStatus, Fault, Kiosk, Rental, RentalDiscrepancy, RentalItem, User } from "../types";
import { useFeedback } from "../Feedback";
import { RentalSummary } from "./Fleet";
import { assetLabel, assetOptions, assetTypeOf, Badge, DateRange, daysSince, dayKey, exportCSV, fmt, inDateRange, isBicycle, operationalStatuses, statuses, useLoad } from "./shared";
function RentalCorrection({
  rental,
  availableBikes,
  onSaved,
}: {
  rental: Rental;
  availableBikes: Bike[];
  onSaved: () => void;
}) {
  const { notify } = useFeedback();
  const [open, setOpen] = useState(false),
    [bikeId, setBikeId] = useState(""),
    [showDiscrepancy, setShowDiscrepancy] = useState(false),
    [bikeCode, setBikeCode] = useState(""),
    [description, setDescription] = useState(""),
    [removingId, setRemovingId] = useState(""),
    [busy, setBusy] = useState(false);
  const choices = availableBikes.filter(
    (b) => b.kiosk_id === rental.start_kiosk_id,
  );
  async function addBike() {
    if (!bikeId) return;
    setBusy(true);
    try {
      await post(`/rentals/${rental.id}/add-bike`, { bike_id: bikeId });
      setBikeId("");
      onSaved();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function removeBike(item: RentalItem) {
    setBusy(true);
    try {
      await post(`/rentals/${rental.id}/remove-bike`, {
        rental_item_id: item.id,
      });
      setRemovingId("");
      onSaved();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function report() {
    if (!bikeCode.trim() || !description.trim()) return;
    setBusy(true);
    try {
      await post(`/rentals/${rental.id}/discrepancies`, {
        bike_code: bikeCode,
        description,
      });
      setBikeCode("");
      setDescription("");
      setShowDiscrepancy(false);
      notify("Discrepância comunicada ao administrador.", "success");
      onSaved();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rental-correction">
      <button className="secondary full" onClick={() => setOpen(!open)}>
        {open ? "Fechar correção" : "Corrigir aluguer"}
      </button>
      {open && (
        <div className="correction-panel">
          <h4>Adicionar item esquecido</h4>
          <div className="correction-add">
            <select value={bikeId} onChange={(e) => setBikeId(e.target.value)}>
              <option value="">Selecionar item disponível…</option>
              {choices.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} · {b.model}
                </option>
              ))}
            </select>
            <button
              className="primary"
              disabled={!bikeId || busy}
              onClick={addBike}
            >
              Adicionar
            </button>
          </div>
          <h4>Itens deste aluguer</h4>
          {rental.items
            .filter((i) => !i.returned_at)
            .map((i) => (
              <div className="row" key={i.id}>
                <span>
                  <b>{i.bike?.code}</b> {i.bike?.model}
                </span>
                {removingId === i.id ? (
                  <span className="inline-confirm">
                    <button className="small-button danger-text" disabled={busy} onClick={() => removeBike(i)}>Confirmar</button>
                    <button className="text" disabled={busy} onClick={() => setRemovingId("")}>Cancelar</button>
                  </span>
                ) : (
                  <button
                    className="text danger-text"
                    disabled={busy || rental.items.filter((x) => !x.returned_at).length <= 1}
                    title={rental.items.filter((x) => !x.returned_at).length <= 1 ? "Não é possível remover o último item." : ""}
                    onClick={() => setRemovingId(i.id)}
                  >Remover</button>
                )}
              </div>
            ))}
          <button
            className="text discrepancy-toggle"
            onClick={() => setShowDiscrepancy(!showDiscrepancy)}
          >
            O item não aparece ou os dados estão errados?
          </button>
          {showDiscrepancy && (
            <div className="discrepancy-form">
              <label>
                Código do item
                <input
                  value={bikeCode}
                  placeholder="Ex.: E007"
                  onChange={(e) => setBikeCode(e.target.value.toUpperCase())}
                />
              </label>
              <label>
                O que está errado?
                <textarea
                  value={description}
                  placeholder="Ex.: o item está no quiosque, mas aparece como alugado."
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={!bikeCode.trim() || !description.trim() || busy}
                onClick={report}
              >
                Comunicar discrepância
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Rentals({ user }: { user: User }) {
  const { notify } = useFeedback();
  const [refresh, setRefresh] = useState(0),
    [dateFrom, setDateFrom] = useState(""),
    [dateTo, setDateTo] = useState(""),
    [returning, setReturning] = useState<Rental | null>(null),
    [resolving, setResolving] = useState(""),
    [resolution, setResolution] = useState(""),
    [anomalies, setAnomalies] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  const { data, error } = useLoad<{
    rentals: Rental[];
    available_bikes: Bike[];
    kiosks: Kiosk[];
    discrepancies: RentalDiscrepancy[];
    summary: {
      completed_today: number;
      completed_week: number;
      completed_month: number;
      completed_all: number;
    };
  }>("/rentals", refresh);
  const visibleRentals = (data?.rentals || []).filter((r) =>
    inDateRange(r.started_at, dateFrom, dateTo),
  );
  async function confirmReturn() {
    if (!returning) return;
    const items = returning.items
      .filter((i) => !i.returned_at)
      .map((i) => ({
        rental_item_id: i.id,
        anomaly: !!anomalies[i.id]?.trim(),
        anomaly_description: anomalies[i.id]?.trim() || "",
      }));
    setBusy(true);
    try {
      await post(`/rentals/${returning.id}/return`, {
        return_kiosk_id: user.usual_kiosk_id || returning.start_kiosk_id,
        items,
      });
      setReturning(null);
      setAnomalies({});
      setRefresh((x) => x + 1);
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="title">
        <div>
          <h1>Alugueres</h1>
          <p>
            {user.role === "admin" ? "Todos os alugueres" : "Os meus alugueres"}
          </p>
        </div>
        <Link className="primary" to="/alugueres/novo">
          Novo aluguer
        </Link>
      </div>
      <RentalSummary
        rentals={data?.rentals || []}
        kiosks={data?.kiosks || []}
        summary={data?.summary}
      />
      <DateRange
        from={dateFrom}
        to={dateTo}
        onFrom={setDateFrom}
        onTo={setDateTo}
      />
      {returning && (
        <section className="card return-box">
          <div className="title">
            <div>
              <h2>Devolver {returning.reference}</h2>
              <p>
                Se estiver tudo bem, basta confirmar. Só escreva nos itens com
                anomalia.
              </p>
            </div>
            <button className="text" onClick={() => setReturning(null)}>
              Cancelar
            </button>
          </div>
          {returning.items
            .filter((i) => !i.returned_at)
            .map((i) => (
              <label key={i.id}>
                {assetLabel(i.bike)} {i.bike?.code}
                <textarea
                  placeholder="Sem anomalia — deixe em branco. Se houver um problema, descreva-o aqui para abrir um ticket."
                  value={anomalies[i.id] || ""}
                  onChange={(e) =>
                    setAnomalies({ ...anomalies, [i.id]: e.target.value })
                  }
                />
              </label>
            ))}
          <button
            className="primary full"
            disabled={busy}
            onClick={confirmReturn}
          >
            {busy ? "A devolver…" : "Confirmar devolução"}
          </button>
        </section>
      )}
      {error && <p className="error">{error}</p>}
      <h2>Em aberto</h2>
      <div className="cards">
        {visibleRentals
          .filter((r) => r.status === "Em aberto")
          .map((r) => (
            <article className="card" key={r.id}>
              <div className="row">
                <b>{r.reference}</b>
                <Badge>{r.status}</Badge>
              </div>
              <h3>{r.customer_ref}</h3>
              {r.customer_contact && (
                <p>
                  Contacto: {" "}
                  <a href={`tel:${r.customer_contact}`}>
                    {r.customer_contact}
                  </a>
                </p>
              )}
              <p>
                {r.items
                  .map((i) => i.bike?.code + (i.returned_at ? " ✓" : ""))
                  .join(" · ")}
              </p>
              <small>Início: {fmt(r.started_at)}</small>
              <small className="block-meta">
                Registado por: {r.started_by_user?.full_name || "—"}
              </small>
              <RentalCorrection
                rental={r}
                availableBikes={data?.available_bikes || []}
                onSaved={() => setRefresh((x) => x + 1)}
              />
              <button
                className="primary full"
                onClick={() => {
                  setAnomalies({});
                  setReturning(r);
                }}
              >
                Devolver
              </button>
            </article>
          ))}
      </div>
      {(data?.discrepancies || []).some((d) => d.status === "Pendente") && (
        <section className="card discrepancy-list">
          <h2>Discrepâncias pendentes</h2>
          <p className="muted">
            Situações em que um item não estava disponível ou apresentava dados
            incorretos no sistema.
          </p>
          {(data?.discrepancies || [])
            .filter((d) => d.status === "Pendente")
            .map((d) => (
              <div className="discrepancy-item" key={d.id}>
                <div>
                  <b>{d.bike_code}</b> · {d.rental?.reference}
                  <p>{d.description}</p>
                  <small>
                    {fmt(d.created_at)} · {d.created_by_user?.full_name || "—"}
                  </small>
                </div>
                {user.role === "admin" && (resolving === d.id ? (
                  <div className="discrepancy-resolution">
                    <label>Resolução<textarea autoFocus value={resolution} onChange={(event) => setResolution(event.target.value)} /></label>
                    <div className="actions">
                      <button className="primary" disabled={!resolution.trim()} onClick={async () => {
                        try {
                          await patch(`/rental-discrepancies/${d.id}/resolve`, { resolution: resolution.trim() });
                          setResolving(""); setResolution(""); setRefresh((value) => value + 1);
                          notify("Discrepância resolvida.", "success");
                        } catch (reason) { notify((reason as Error).message, "error"); }
                      }}>Guardar resolução</button>
                      <button className="secondary" onClick={() => { setResolving(""); setResolution(""); }}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <button className="secondary" onClick={() => { setResolving(d.id); setResolution(""); }}>Marcar como resolvida</button>
                ))}
              </div>
            ))}
        </section>
      )}
      <h2>Concluídos recentes</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Referência</th>
              <th>Cliente</th>
              <th>Itens</th>
              <th>Registado por</th>
              <th>Início</th>
              <th>Fim</th>
            </tr>
          </thead>
          <tbody>
            {visibleRentals
              .filter((r) => r.status === "Concluído")
              .map((r) => (
                <tr key={r.id}>
                  <td>{r.reference}</td>
                  <td>{r.customer_ref}</td>
                  <td>{r.items.map((i) => i.bike?.code).join(", ")}</td>
                  <td>{r.started_by_user?.full_name || "—"}</td>
                  <td>{fmt(r.started_at)}</td>
                  <td>{fmt(r.returned_at)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

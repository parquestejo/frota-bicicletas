import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, post, patch } from "../api";
import type { AssetType, Bike, BikeStatus, Fault, Kiosk, Rental, RentalDiscrepancy, RentalItem, RentalPeriodUpdate, User } from "../types";
import { useFeedback } from "../Feedback";
import { RentalSummary } from "./Fleet";
const rentalMoney = (value: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(value || 0));
const dayPrices: Record<AssetType, number> = { electric: 10, conventional: 6, child: 3, stroller: 3, helmet: 1, lock: 0 };
const bicycleTypes = new Set<AssetType>(["electric", "conventional", "child"]);
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

function RentalPeriodExtension({ rental, onSaved }: { rental: Rental; onSaved: () => void }) {
  const { notify } = useFeedback();
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false);
  if (rental.rental_kind === "institutional" || rental.rental_period !== "hour") return null;
  const dayCommercial = rental.items.reduce((sum, item) => sum + dayPrices[item.bike?.asset_type || "lock"], 0);
  const dayPayable = rental.rental_kind === "resident"
    ? rental.items.filter((item) => !bicycleTypes.has(item.bike?.asset_type || "lock")).reduce((sum, item) => sum + dayPrices[item.bike?.asset_type || "lock"], 0)
    : dayCommercial;
  const additional = Math.max(dayPayable - Number(rental.charged_amount || 0), 0);
  async function extend() {
    setBusy(true);
    try {
      const result = await post<RentalPeriodUpdate>(`/rentals/${rental.id}/extend-day`, {});
      notify(`Aluguer prolongado para 1 dia. Cobrar mais ${rentalMoney(result.additional_amount || 0)}.`, "success");
      setConfirming(false);
      onSaved();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return <div className="rental-period-extension">
    <button className="secondary full" onClick={() => setConfirming(!confirming)}>{confirming ? "Cancelar prolongamento" : "Prolongar para 1 dia"}</button>
    {confirming && <div className="correction-panel" role="status">
      <h4>Prolongar para 1 dia</h4>
      <p>Novo total a cobrar: <b>{rentalMoney(dayPayable)}</b></p>
      <p>Valor adicional a cobrar agora: <b>{rentalMoney(additional)}</b></p>
      <button className="primary full" disabled={busy} onClick={extend}>{busy ? "A guardar…" : "Confirmar prolongamento"}</button>
    </div>}
  </div>;
}

const localInput = (value?: string) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0,16) : "";
function AdminRentalCorrection({ rental, bikes, kiosks, onSaved }: { rental: Rental; bikes: Bike[]; kiosks: Kiosk[]; onSaved: () => void }) {
  const { notify } = useFeedback();
  const [open,setOpen]=useState(false), [busy,setBusy]=useState(false), [voidRental,setVoidRental]=useState(false),
    [period,setPeriod]=useState<"hour"|"day">(rental.rental_period === "day" ? "day" : "hour"), [periodReason,setPeriodReason]=useState("");
  const [form,setForm]=useState(() => ({ customer_ref:rental.customer_ref, customer_contact:rental.customer_contact || "", charged_amount:String(rental.charged_amount), start_kiosk_id:rental.start_kiosk_id, started_at:localInput(rental.started_at), returned_at:localInput(rental.returned_at), reason:"", items:rental.items.map((item) => ({ id:item.id,bike_id:item.bike_id,return_kiosk_id:item.return_kiosk_id || item.return_kiosk?.id || rental.start_kiosk_id,returned_at:localInput(item.returned_at || rental.returned_at) })) }));
  async function save() {
    if (form.reason.trim().length < 5) return notify("Indique o motivo da correção.","error");
    setBusy(true); try {
      await patch(`/rentals/${rental.id}/correct`, { ...form, charged_amount:Number(form.charged_amount), started_at:new Date(form.started_at).toISOString(), returned_at:form.returned_at ? new Date(form.returned_at).toISOString() : null, items:form.items.map((item) => ({ ...item, returned_at:item.returned_at ? new Date(item.returned_at).toISOString() : null })), void:voidRental });
      notify(voidRental ? "Aluguer anulado, mantendo o histórico." : "Aluguer corrigido.","success"); setOpen(false); onSaved();
    } catch(e) { notify((e as Error).message,"error"); } finally { setBusy(false); }
  }
  async function savePeriod() {
    if (periodReason.trim().length < 5) return notify("Indique o motivo da correção do período.","error");
    setBusy(true); try {
      const result = await patch<RentalPeriodUpdate>(`/rentals/${rental.id}/correct-period`, { rental_period:period, reason:periodReason });
      notify(`Período corrigido. Valor comercial: ${rentalMoney(result.expected_amount)}. O valor cobrado não foi alterado.`,"success");
      setPeriodReason(""); onSaved();
    } catch(e) { notify((e as Error).message,"error"); } finally { setBusy(false); }
  }
  return <div className="admin-correction">
    <button className="text" onClick={() => setOpen(!open)}>{open ? "Fechar" : "Correção administrativa"}</button>
    {open && <div className="correction-panel admin-correction-panel">
      <h3>Corrigir {rental.reference}</h3>
      {rental.rental_kind !== "institutional" && rental.status !== "Anulado" && <section className="period-correction">
        <h4>Corrigir período</h4>
        <div className="form-grid"><label>Período<select value={period} onChange={(e)=>setPeriod(e.target.value as "hour"|"day")}><option value="hour">1 hora</option><option value="day">1 dia</option></select></label><label>Motivo da correção<input value={periodReason} onChange={(e)=>setPeriodReason(e.target.value)} placeholder="Ex.: cliente prolongou para 1 dia"/></label></div>
        <p className="muted">Recalcula o valor comercial. O montante efetivamente cobrado mantém-se até ser corrigido no campo abaixo.</p>
        <button className="secondary" disabled={busy || periodReason.trim().length<5 || period===rental.rental_period} onClick={savePeriod}>Corrigir período</button>
      </section>}
      <div className="form-grid"><label>Referência do cliente<input value={form.customer_ref} onChange={(e)=>setForm({...form,customer_ref:e.target.value})}/></label>{rental.status === "Em aberto" && <label>Contacto temporário<input value={form.customer_contact} onChange={(e)=>setForm({...form,customer_contact:e.target.value})}/></label>}<label>Valor cobrado (€)<input type="number" min="0" step=".01" value={form.charged_amount} onChange={(e)=>setForm({...form,charged_amount:e.target.value})}/></label><label>Quiosque de saída<select value={form.start_kiosk_id} onChange={(e)=>setForm({...form,start_kiosk_id:e.target.value})}>{kiosks.map((k)=><option key={k.id} value={k.id}>{k.name}</option>)}</select></label><label>Início<input type="datetime-local" value={form.started_at} onChange={(e)=>setForm({...form,started_at:e.target.value})}/></label>{rental.status === "Concluído" && <label>Fim do aluguer<input type="datetime-local" value={form.returned_at} onChange={(e)=>setForm({...form,returned_at:e.target.value})}/></label>}</div>
      {rental.status === "Concluído" && <><h4>Itens e devoluções</h4>{form.items.map((item,index)=><div className="form-grid" key={item.id}><label>Item<select value={item.bike_id} onChange={(e)=>setForm({...form,items:form.items.map((x,i)=>i===index?{...x,bike_id:e.target.value}:x)})}>{bikes.map((b)=><option key={b.id} value={b.id}>{b.code} · {b.model}</option>)}</select></label><label>Local de devolução<select value={item.return_kiosk_id} onChange={(e)=>setForm({...form,items:form.items.map((x,i)=>i===index?{...x,return_kiosk_id:e.target.value}:x)})}>{kiosks.map((k)=><option key={k.id} value={k.id}>{k.name}</option>)}</select></label><label>Data da devolução<input type="datetime-local" value={item.returned_at} onChange={(e)=>setForm({...form,items:form.items.map((x,i)=>i===index?{...x,returned_at:e.target.value}:x)})}/></label></div>)}</>}
      <label>Motivo obrigatório<textarea value={form.reason} onChange={(e)=>setForm({...form,reason:e.target.value})} placeholder="Explique o erro e a correção efetuada."/></label>
      <label className="toggle-row"><input type="checkbox" checked={voidRental} onChange={(e)=>setVoidRental(e.target.checked)}/> Anular este aluguer (mantém o registo no histórico)</label>
      <button className={voidRental?"danger":"primary"} disabled={busy || form.reason.trim().length<5} onClick={save}>{busy?"A guardar…":voidRental?"Confirmar anulação":"Guardar correção"}</button>
    </div>}
  </div>;
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
    [returnItemIds, setReturnItemIds] = useState<string[]>([]),
    [returnKioskId, setReturnKioskId] = useState(""),
    [retainedDeposits, setRetainedDeposits] = useState<Record<string, string>>({}),
    [retentionReasons, setRetentionReasons] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  const { data, error } = useLoad<{
    rentals: Rental[];
    available_bikes: Bike[];
    correction_bikes: Bike[];
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
      .filter((i) => !i.returned_at && returnItemIds.includes(i.id))
      .map((i) => ({
        rental_item_id: i.id,
        anomaly: !!anomalies[i.id]?.trim(),
        anomaly_description: anomalies[i.id]?.trim() || "",
        deposit_retained: Number(retainedDeposits[i.id] || 0),
        deposit_retention_reason: retentionReasons[i.id]?.trim() || "",
      }));
    if (!items.length) return notify("Selecione pelo menos um item a devolver.", "error");
    if (items.some((item)=>item.deposit_retained>0 && item.deposit_retention_reason.length<5)) return notify("Indique o motivo de cada caução retida.", "error");
    setBusy(true);
    try {
      await post(`/rentals/${returning.id}/return`, {
        return_kiosk_id: returnKioskId || user.usual_kiosk_id || returning.start_kiosk_id,
        items,
      });
      setReturning(null);
      setAnomalies({});
      setReturnItemIds([]); setRetainedDeposits({}); setRetentionReasons({});
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
          <label>Quiosque de devolução<select value={returnKioskId} onChange={(e)=>setReturnKioskId(e.target.value)}>{(data?.kiosks || []).map((k)=><option key={k.id} value={k.id}>{k.name}</option>)}</select></label>
          {returning.items
            .filter((i) => !i.returned_at)
            .map((i) => (
              <div className="return-item" key={i.id}>
                <label><input type="checkbox" checked={returnItemIds.includes(i.id)} onChange={(e)=>setReturnItemIds((current)=>e.target.checked?[...current,i.id]:current.filter((id)=>id!==i.id))}/> <b>{assetLabel(i.bike)} {i.bike?.code}</b></label>
                {returnItemIds.includes(i.id) && <>
                <textarea
                  placeholder="Sem anomalia — deixe em branco. Se houver um problema, descreva-o aqui para abrir um ticket."
                  value={anomalies[i.id] || ""}
                  onChange={(e) =>
                    setAnomalies({ ...anomalies, [i.id]: e.target.value })
                  }
                />
                {returning.rental_kind !== "institutional" && isBicycle(i.bike) && <div className="form-grid"><label>Caução retida (€)<input type="number" min="0" max="50" step="0.01" value={retainedDeposits[i.id] || "0"} onChange={(e)=>setRetainedDeposits({...retainedDeposits,[i.id]:e.target.value})}/></label>{Number(retainedDeposits[i.id] || 0)>0 && <label>Motivo da retenção<input value={retentionReasons[i.id] || ""} onChange={(e)=>setRetentionReasons({...retentionReasons,[i.id]:e.target.value})}/></label>}</div>}
                </>}
              </div>
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
              <p><b>{rentalMoney(r.charged_amount)}</b> · {r.rental_kind === "institutional" ? "Utilização institucional" : r.rental_kind === "resident" ? "Benefício de residente" : "Multibanco"}</p>
              {r.expected_amount !== undefined && <small>Valor comercial: {rentalMoney(r.expected_amount)}</small>}
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
              <RentalPeriodExtension rental={r} onSaved={() => setRefresh((x) => x + 1)} />
              {user.role === "admin" && <AdminRentalCorrection rental={r} bikes={data?.correction_bikes || []} kiosks={data?.kiosks || []} onSaved={() => setRefresh((x)=>x+1)} />}
              <button
                className="primary full"
                onClick={() => {
                  setAnomalies({});
                  const pending=r.items.filter((i)=>!i.returned_at).map((i)=>i.id); setReturnItemIds(pending); setReturnKioskId(user.usual_kiosk_id || r.start_kiosk_id); setRetainedDeposits({}); setRetentionReasons({});
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
      <h2>Concluídos e anulados recentes</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Referência</th>
              <th>Cliente</th>
              <th>Estado</th>
              <th>Itens</th>
              <th>Valor</th>
              <th>Registado por</th>
              <th>Início</th>
              <th>Fim</th>
              {user.role === "admin" && <th>Ação</th>}
            </tr>
          </thead>
          <tbody>
            {visibleRentals
              .filter((r) => r.status !== "Em aberto")
              .map((r) => (
                <tr key={r.id}>
                  <td>{r.reference}</td>
                  <td>{r.customer_ref}</td>
                  <td><Badge>{r.status}</Badge>{r.corrected_at && <small className="block-meta">Corrigido</small>}</td>
                  <td>{r.items.map((i) => i.bike?.code).join(", ")}</td>
                  <td>{rentalMoney(r.charged_amount)}</td>
                  <td>{r.started_by_user?.full_name || "—"}</td>
                  <td>{fmt(r.started_at)}</td>
                  <td>{fmt(r.returned_at)}</td>
                  {user.role === "admin" && <td><AdminRentalCorrection rental={r} bikes={data?.correction_bikes || []} kiosks={data?.kiosks || []} onSaved={() => setRefresh((x)=>x+1)} /></td>}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

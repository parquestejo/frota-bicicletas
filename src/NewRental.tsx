import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, post } from "./api";
import type { AssetType, Bike, Kiosk, User } from "./types";

type RentalKind = "normal" | "resident" | "institutional";
type RentalPeriod = "hour" | "day";
const prices: Record<RentalPeriod, Record<AssetType, number>> = {
  hour: { electric: 4, conventional: 2, child: 2, stroller: 2, helmet: 1, lock: 0 },
  day: { electric: 10, conventional: 6, child: 3, stroller: 3, helmet: 1, lock: 0 },
};
const bicycles = new Set<AssetType>(["electric", "conventional", "child"]);
const money = (value: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(value);

export function NewRental({ user }: { user: User }) {
  const navigate = useNavigate();
  const [data, setData] = useState<{
      available_bikes: Bike[];
      kiosks: Kiosk[];
    } | null>(null),
    [loadError, setLoadError] = useState(""),
    [message, setMessage] = useState(""),
    [customer, setCustomer] = useState(""),
    [customerContact, setCustomerContact] = useState(""),
    [chargedAmount, setChargedAmount] = useState("0"),
    [kind, setKind] = useState<RentalKind>("normal"),
    [period, setPeriod] = useState<RentalPeriod>("hour"),
    [oeirasMove, setOeirasMove] = useState(false),
    [residentProof, setResidentProof] = useState(""),
    [institutionalEntity, setInstitutionalEntity] = useState(""),
    [priceReason, setPriceReason] = useState(""),
    [kiosk, setKiosk] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ available_bikes: Bike[]; kiosks: Kiosk[] }>("/rentals")
      .then(setData)
      .catch((e) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    if (data && !kiosk)
      setKiosk(user.usual_kiosk_id || data.kiosks[0]?.id || "");
  }, [data, kiosk, user.usual_kiosk_id]);

  async function start(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!customer.trim()) {
      setMessage("Indique o cliente ou uma referência.");
      return;
    }
    if (!selected.length) {
      setMessage("Selecione pelo menos uma bicicleta ou acessório.");
      return;
    }
    if (kind === "resident" && (!oeirasMove || !residentProof)) {
      setMessage("Confirme a App Oeiras Move e o comprovativo de residência.");
      return;
    }
    if (kind === "institutional" && !institutionalEntity) {
      setMessage("Selecione a entidade responsável pela utilização institucional.");
      return;
    }
    if (chargedAmount === "" || Number(chargedAmount) < 0) {
      setMessage("Indique o valor cobrado por Multibanco.");
      return;
    }
    if (Math.abs(Number(chargedAmount) - payableAmount) > 0.001 && priceReason.trim().length < 5) {
      setMessage("Explique a diferença entre o valor calculado e o valor cobrado.");
      return;
    }
    setBusy(true);
    try {
      await post("/rentals", {
        customer_ref: customer,
        customer_contact: customerContact,
        start_kiosk_id: kiosk,
        bike_ids: selected,
        charged_amount: Number(chargedAmount),
        rental_kind: kind,
        rental_period: period,
        oeiras_move_confirmed: kind === "resident" ? oeirasMove : false,
        resident_proof_type: kind === "resident" ? residentProof : null,
        institutional_entity: kind === "institutional" ? institutionalEntity : null,
        institutional_person: kind === "institutional" ? customer.trim() : null,
        price_override_reason: Math.abs(Number(chargedAmount) - payableAmount) > 0.001 ? priceReason.trim() : null,
      });
      navigate("/alugueres");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const available =
    data?.available_bikes.filter((bike) => bike.kiosk_id === kiosk) || [];
  const chosen = available.filter((item) => selected.includes(item.id));
  const commercialAmount = chosen.reduce((sum, item) => sum + prices[period][item.asset_type], 0);
  const payableAmount = kind === "institutional" ? 0 : kind === "resident"
    ? chosen.filter((item) => !bicycles.has(item.asset_type)).reduce((sum, item) => sum + prices[period][item.asset_type], 0)
    : commercialAmount;
  const depositAmount = kind === "institutional" ? 0 : chosen.filter((item) => bicycles.has(item.asset_type)).length * 50;

  useEffect(() => { setChargedAmount(payableAmount.toFixed(2)); }, [payableAmount]);

  return (
    <>
      <div className="title">
        <div>
          <h1>Novo aluguer</h1>
          <p>Registe o cliente e selecione os itens a alugar</p>
        </div>
        <Link className="secondary" to="/alugueres">
          Cancelar
        </Link>
      </div>
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {!data ? (
        !loadError && <p>A carregar…</p>
      ) : (
        <form className="card form" onSubmit={start} noValidate>
          <label>
            {kind === "institutional" ? "Nome de quem levantou" : "Cliente ou referência"}
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              aria-invalid={!!message && !customer.trim()}
              aria-describedby={message ? "new-rental-error" : undefined}
              required
            />
          </label>
          <fieldset>
            <legend>Tipo de utilização</legend>
            <div className="choice-row">
              <label><input type="radio" checked={kind === "normal"} onChange={()=>setKind("normal")}/> Aluguer normal</label>
              <label><input type="radio" checked={kind === "resident"} onChange={()=>setKind("resident")}/> Benefício de residente</label>
              <label><input type="radio" checked={kind === "institutional"} onChange={()=>setKind("institutional")}/> Atividade institucional</label>
            </div>
          </fieldset>
          <label>Período<select value={period} onChange={(e)=>setPeriod(e.target.value as RentalPeriod)}><option value="hour">1 hora</option><option value="day">1 dia</option></select></label>
          {kind === "resident" && <fieldset><legend>Condições do benefício</legend>
            <label><input type="checkbox" checked={oeirasMove} onChange={(e)=>setOeirasMove(e.target.checked)}/> App Oeiras Move instalada</label>
            <label>Comprovativo de residência<select value={residentProof} onChange={(e)=>setResidentProof(e.target.value)}><option value="">Selecionar…</option><option>AT</option><option>Dístico de residente</option><option>Subscrição 120 minutos</option></select></label>
          </fieldset>}
          {kind === "institutional" && <label>Entidade<select value={institutionalEntity} onChange={(e)=>setInstitutionalEntity(e.target.value)}><option value="">Selecionar…</option><option>Parques Tejo</option><option>Município de Oeiras</option></select></label>}
          <label>
            Número de contacto (opcional)
            <input
              type="tel"
              autoComplete="tel"
              maxLength={50}
              value={customerContact}
              onChange={(e) => setCustomerContact(e.target.value)}
            />
          </label>
          <label>
            Quiosque de saída
            <select value={kiosk} onChange={(e) => setKiosk(e.target.value)}>
              {data.kiosks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Valor cobrado (€)
            <input type="number" inputMode="decimal" min="0" max="100000" step="0.01"
              value={chargedAmount} onChange={(e) => setChargedAmount(e.target.value)} required />
          </label>
          <div className="notice"><b>Valor comercial: {money(commercialAmount)}</b><br/>Valor a cobrar: {money(payableAmount)}<br/>{kind === "institutional" ? "Caução dispensada" : `Caução a solicitar: ${money(depositAmount)} (${money(50)} por bicicleta)`}</div>
          {Math.abs(Number(chargedAmount || 0) - payableAmount) > 0.001 && <label>Motivo da diferença<input value={priceReason} onChange={(e)=>setPriceReason(e.target.value)} placeholder="Justificação obrigatória"/></label>}
          <fieldset aria-invalid={!!message && !selected.length}>
            <legend>Bicicletas e acessórios disponíveis</legend>
            <div className="bike-picker">
              {available.map((bike) => (
                <label key={bike.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(bike.id)}
                    onChange={(e) =>
                      setSelected((current) =>
                        e.target.checked
                          ? [...current, bike.id]
                          : current.filter((id) => id !== bike.id),
                      )
                    }
                  />
                  <b>{bike.code}</b> {bike.model}
                </label>
              ))}
              {!available.length && (
                <p className="muted">Não existem itens disponíveis neste quiosque.</p>
              )}
            </div>
          </fieldset>
          {message && (
            <div
              id="new-rental-error"
              className="error"
              role="alert"
              aria-live="polite"
            >
              {message}
            </div>
          )}
          <button
            className="primary"
            disabled={busy}
          >
            {busy ? "A guardar…" : "Iniciar aluguer"}
          </button>
        </form>
      )}
    </>
  );
}

import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, post } from "./api";
import type { Bike, Kiosk, User } from "./types";

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
    setBusy(true);
    try {
      await post("/rentals", {
        customer_ref: customer,
        customer_contact: customerContact,
        start_kiosk_id: kiosk,
        bike_ids: selected,
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
            Cliente ou referência
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              aria-invalid={!!message && !customer.trim()}
              aria-describedby={message ? "new-rental-error" : undefined}
              required
            />
          </label>
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

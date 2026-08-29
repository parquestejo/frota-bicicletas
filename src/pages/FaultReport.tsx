import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, post, patch } from "../api";
import type { AssetType, Bike, BikeStatus, Fault, Kiosk, Rental, RentalDiscrepancy, RentalItem, User } from "../types";
import { useFeedback } from "../Feedback";
import { assetLabel, assetOptions, assetTypeOf, Badge, DateRange, daysSince, dayKey, exportCSV, fmt, inDateRange, isBicycle, operationalStatuses, statuses, useLoad } from "./shared";
export function FaultReport() {
  const { data, error } = useLoad<{ bikes: Bike[] }>("/faults/report-options");
  const [form, setForm] = useState({
      bike_id: "",
      category: "travões",
      description: "",
      severity: "Média",
      usable: false,
    }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function create() {
    setBusy(true);
    setMessage("");
    try {
      await post("/faults", form);
      setForm({
        bike_id: "",
        category: "travões",
        description: "",
        severity: "Média",
        usable: false,
      });
      setMessage("A avaria foi comunicada com sucesso.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="title">
        <div>
          <h1>Comunicar avaria</h1>
          <p>
            Registe apenas os dados necessários para a equipa de manutenção.
          </p>
        </div>
      </div>
      <section className="card form fault-report-form">
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
            placeholder="Descreva o problema encontrado."
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        {error && <div className="error">{error}</div>}
        {message && (
          <div className={message.includes("sucesso") ? "success" : "error"}>
            {message}
          </div>
        )}
        <button
          className="primary"
          disabled={busy || !form.bike_id || !form.description.trim()}
          onClick={create}
        >
          {busy ? "A registar…" : "Comunicar avaria"}
        </button>
      </section>
    </>
  );
}

export const faultStatuses = [
  "Aberta",
  "Em análise",
  "Em reparação",
  "Resolvida",
  "Cancelada",
];

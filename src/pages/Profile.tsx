import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, post, patch } from "../api";
import type { AssetType, Bike, BikeStatus, Fault, Kiosk, Rental, RentalDiscrepancy, RentalItem, User } from "../types";
import { useFeedback } from "../Feedback";
import { assetLabel, assetOptions, assetTypeOf, Badge, DateRange, daysSince, dayKey, exportCSV, fmt, inDateRange, isBicycle, operationalStatuses, statuses, useLoad } from "./shared";
export function Profile({ user }: { user: User }) {
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function save() {
    setMessage("");
    if (password.length < 6)
      return setMessage(
        "A nova palavra-passe deve ter pelo menos 6 caracteres.",
      );
    if (password !== confirm)
      return setMessage("As duas novas palavras-passe não são iguais.");
    setBusy(true);
    try {
      await post("/auth/change-password", {
        current_password: current,
        password,
      });
      setCurrent("");
      setPassword("");
      setConfirm("");
      setMessage("Palavra-passe alterada com sucesso.");
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
          <h1>O meu perfil</h1>
          <p>
            {user.full_name} · {user.username}
          </p>
        </div>
      </div>
      <section className="card profile-form">
        <h2>Alterar palavra-passe</h2>
        <label>
          Palavra-passe atual
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          Nova palavra-passe
          <input
            type="password"
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <small>Mínimo de 6 caracteres.</small>
        </label>
        <label>
          Repita a nova palavra-passe
          <input
            type="password"
            minLength={6}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {message && (
          <div className={message.includes("sucesso") ? "success" : "error"}>
            {message}
          </div>
        )}
        <button
          className="primary"
          disabled={busy || !current || !password || !confirm}
          onClick={save}
        >
          {busy ? "A guardar…" : "Alterar palavra-passe"}
        </button>
      </section>
    </>
  );
}


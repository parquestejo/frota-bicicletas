import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, post, patch } from "../api";
import type { AssetType, Bike, BikeStatus, Fault, Kiosk, Rental, RentalDiscrepancy, RentalItem, User } from "../types";
import { useFeedback } from "../Feedback";
import { assetLabel, assetOptions, assetTypeOf, Badge, DateRange, daysSince, dayKey, exportCSV, fmt, inDateRange, isBicycle, operationalStatuses, statuses, useLoad } from "./shared";
import { AdminDashboard } from "../AdminDashboard";
export function Dashboard({ user }: { user: User }) {
  const maintenance = user.role === "manutencao";
  const canViewFaults = user.role !== "funcionario";
  const dashboardStatuses =
    user.role === "funcionario" ? operationalStatuses : statuses;
  const { data, error } = useLoad<any>("/dashboard");
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>A carregar…</p>;
  return (
    <>
      <div className="title">
        <div>
          <h1>Dashboard</h1>
          <p>Estado atual da operação</p>
        </div>
      </div>
      <div className="metrics">
        {dashboardStatuses.map((s) => {
          const c = data.counts_by_type?.[s] || {
            total: data.counts[s] || 0,
            electric: 0,
            conventional: 0,
            child: 0,
            helmet: 0,
            lock: 0,
            stroller: 0,
          };
          return (
            <div className="card metric" key={s}>
              <Badge>{s}</Badge>
              <b>{c.total}</b>
              <div className="metric-types">
                <span>
                  Elétricas <strong>{c.electric}</strong>
                </span>
                <span>
                  Convencionais <strong>{c.conventional}</strong>
                </span>
                <span>
                  Infantis <strong>{c.child || 0}</strong>
                </span>
                <span>
                  Acessórios{" "}
                  <strong>
                    {(c.helmet || 0) + (c.lock || 0) + (c.stroller || 0)}
                  </strong>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="actions">
        {!maintenance && (
          <>
            <Link className="primary" to="/alugueres/novo">
              Novo aluguer
            </Link>
            <Link className="secondary" to="/alugueres">
              Registar devolução
            </Link>
          </>
        )}
        <Link className="secondary" to="/comunicar-avaria">
          Comunicar avaria
        </Link>
        <Link className="secondary" to="/frota">
          Ver frota
        </Link>
      </div>
      {user.role === "funcionario" && (
        <section
          className={
            "card daily-closure-alert " +
            (data.daily_closure?.status === "Submetido" ? "done" : "pending")
          }
        >
          <div>
            <h2>Fecho diário</h2>
            <p>
              {data.daily_closure?.status === "Submetido"
                ? `O fecho de hoje foi submetido${data.daily_closure.kiosk?.name ? ` para ${data.daily_closure.kiosk.name}` : ""}.`
                : data.daily_closure?.status === "Rascunho"
                  ? "O fecho de hoje está guardado como rascunho."
                  : "O fecho de hoje ainda não foi preenchido."}
            </p>
          </div>
          <Link className="secondary" to="/fecho-diario">
            {data.daily_closure?.status === "Submetido"
              ? "Consultar fecho"
              : "Preencher fecho"}
          </Link>
        </section>
      )}
      {user.role === "admin" && <AdminDashboard data={data.admin_management} />}
      {!maintenance && (
        <section className="card rented-section">
          <div className="title compact-title">
            <div>
              <h2>Itens alugados</h2>
              <p>Distribuição atual por tipologia e quiosque</p>
            </div>
            <strong className="rented-total">{data.rented?.total || 0}</strong>
          </div>
          <div className="rented-type-grid">
            <div>
              <span>Elétricas</span>
              <b>{data.rented?.electric || 0}</b>
            </div>
            <div>
              <span>Convencionais</span>
              <b>{data.rented?.conventional || 0}</b>
            </div>
            <div>
              <span>Infantis</span>
              <b>{data.rented?.child || 0}</b>
            </div>
            <div>
              <span>Acessórios</span>
              <b>{data.rented?.accessories || 0}</b>
            </div>
          </div>
          <div className="table-wrap">
            <table className="rented-table">
              <thead>
                <tr>
                  <th>Quiosque</th>
                  <th>Elétricas</th>
                  <th>Convencionais</th>
                  <th>Infantis</th>
                  <th>Acessórios</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rented?.by_kiosk.map((k: any) => (
                  <tr key={k.id}>
                    <td>
                      <b>{k.name}</b>
                    </td>
                    <td>{k.electric}</td>
                    <td>{k.conventional}</td>
                    <td>{k.child}</td>
                    <td>{k.accessories}</td>
                    <td>
                      <b>{k.total}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="grid2">
        <section className="card">
          <h2>Por localização</h2>
          {data.kiosks.map((k: any) => (
            <div className="row" key={k.id}>
              <span>{k.name}</span>
              <b>{k.total}</b>
            </div>
          ))}
        </section>
        <section className="card">
          <h2>Operação</h2>
          {!maintenance && (
            <div className="row">
              <span>Alugueres em aberto</span>
              <b>{data.open_rentals}</b>
            </div>
          )}
          {canViewFaults && (
            <div className="row">
              <span>Avarias pendentes</span>
              <b>{data.pending_faults}</b>
            </div>
          )}
        </section>
      </div>
      <div className="grid2">
        {!maintenance && (
          <section className="card">
            <h2>Devoluções recentes</h2>
            {data.recent_returns.length ? (
              data.recent_returns.map((r: any) => (
                <div className="row" key={r.id}>
                  <span>
                    {r.bike_code} · {r.customer_ref}
                  </span>
                  <small>{fmt(r.returned_at)}</small>
                </div>
              ))
            ) : (
              <p className="muted">Sem devoluções.</p>
            )}
          </section>
        )}
        {canViewFaults && (
          <section className="card">
            <h2>Avarias pendentes</h2>
            {data.faults.map((f: any) => (
              <div className="row" key={f.id}>
                <span>
                  Item {f.bike_code} · {f.category}
                </span>
                <Badge>{f.status}</Badge>
              </div>
            ))}
          </section>
        )}
      </div>
    </>
  );
}


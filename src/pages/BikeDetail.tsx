import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, post, patch } from "../api";
import type { AssetType, Bike, BikeStatus, Fault, Kiosk, Rental, RentalDiscrepancy, RentalItem, User } from "../types";
import { useFeedback } from "../Feedback";
import { assetLabel, assetOptions, assetTypeOf, Badge, DateRange, daysSince, dayKey, exportCSV, fmt, inDateRange, isBicycle, operationalStatuses, statuses, useLoad } from "./shared";
export function BikeDetail({ user }: { user: User }) {
  const { id } = useParams();
  const { data, error } = useLoad<{
    bike: Bike;
    rental_items: RentalItem[];
    faults: Fault[];
  }>(`/bikes/${id}/history`);
  if (error)
    return (
      <>
        <Link className="secondary" to="/frota">
          Voltar à frota
        </Link>
        <p className="error">{error}</p>
      </>
    );
  if (!data) return <p>A carregar ficha…</p>;
  const { bike, rental_items, faults } = data;
  return (
    <>
      <div className="title">
        <div>
          <Link className="text" to="/frota">
            ← Voltar à frota
          </Link>
          <h1>Item {bike.code}</h1>
          <p>
            {assetLabel(bike)} · {bike.model}
          </p>
        </div>
        <Badge>{bike.status}</Badge>
      </div>
      <section className="card bike-summary">
        <div>
          <span>Localização</span>
          <b>{bike.kiosk?.name || "—"}</b>
        </div>
        {user.role !== "manutencao" && (
          <div>
            <span>Total de alugueres</span>
            <b>{rental_items.length}</b>
          </div>
        )}
        <div>
          <span>Ocorrências de manutenção</span>
          <b>{faults.length}</b>
        </div>
        <div>
          <span>Última atualização</span>
          <b>{fmt(bike.updated_at)}</b>
        </div>
      </section>
      {user.role !== "manutencao" && (
        <>
          <div className="title section-title">
            <div>
              <h2>Histórico de alugueres</h2>
              <p>Todos os alugueres em que este item foi incluído.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Referência</th>
                  <th>Cliente</th>
                  <th>Saída</th>
                  <th>Devolução</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th>Registado por</th>
                  <th>Anomalia</th>
                </tr>
              </thead>
              <tbody>
                {rental_items.length ? (
                  rental_items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <b>{i.rental?.reference}</b>
                      </td>
                      <td>{i.rental?.customer_ref}</td>
                      <td>{i.rental?.start_kiosk?.name || "—"}</td>
                      <td>{i.return_kiosk?.name || "—"}</td>
                      <td>{fmt(i.rental?.started_at)}</td>
                      <td>{fmt(i.returned_at)}</td>
                      <td>{i.rental?.started_by_user?.full_name || "—"}</td>
                      <td>
                        {i.anomaly ? i.anomaly_description || "Sim" : "Não"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8}>Sem alugueres registados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="title section-title">
        <div>
          <h2>Histórico de avarias e manutenção</h2>
          <p>Problemas identificados e reparações realizadas.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Origem</th>
              <th>Categoria</th>
              <th>Descrição da avaria</th>
              <th>Gravidade</th>
              <th>Estado</th>
              <th>Reparação/notas</th>
              <th>Registado por</th>
            </tr>
          </thead>
          <tbody>
            {faults.length ? (
              faults.map((f) => (
                <tr key={f.id}>
                  <td>{fmt(f.created_at)}</td>
                  <td>{f.origin}</td>
                  <td>{f.category}</td>
                  <td>{f.description}</td>
                  <td>{f.severity}</td>
                  <td>
                    <Badge>{f.status}</Badge>
                  </td>
                  <td>
                    {f.interventions?.length
                      ? f.interventions.map((x) => (
                          <div key={x.id}>
                            <b>{fmt(x.intervention_date)}</b> · {x.description}
                          </div>
                        ))
                      : f.notes || "—"}
                  </td>
                  <td>{f.created_by_user?.full_name || "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8}>Sem ocorrências registadas.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}


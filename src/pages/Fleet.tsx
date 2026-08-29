import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, post, patch } from "../api";
import type { AssetType, Bike, BikeStatus, Fault, Kiosk, Rental, RentalDiscrepancy, RentalItem, User } from "../types";
import { useFeedback } from "../Feedback";
import { assetLabel, assetOptions, assetTypeOf, Badge, DateRange, daysSince, dayKey, exportCSV, fmt, inDateRange, isBicycle, operationalStatuses, statuses, useLoad } from "./shared";
function BikeAdminControls({
  bike,
  kiosks,
  canEditIdentity,
  onSaved,
}: {
  bike: Bike;
  kiosks: Kiosk[];
  canEditIdentity: boolean;
  onSaved: () => void;
}) {
  const { notify } = useFeedback();
  const [status, setStatus] = useState<BikeStatus>(bike.status),
    [kiosk, setKiosk] = useState(bike.kiosk_id),
    [code, setCode] = useState(bike.code),
    [assetType, setAssetType] = useState<AssetType>(assetTypeOf(bike)),
    [model, setModel] = useState(bike.model),
    [active, setActive] = useState(bike.active !== false),
    [busy, setBusy] = useState(false),
    [description, setDescription] = useState("");
  const changed =
    status !== bike.status ||
    kiosk !== bike.kiosk_id ||
    code !== bike.code ||
    assetType !== assetTypeOf(bike) ||
    model !== bike.model ||
    active !== (bike.active !== false);
  const rented = bike.status === "Alugada";
  return (
    <div className="inline-edit">
      <select
        aria-label={"Estado do item " + bike.code}
        value={status}
        disabled={rented}
        onChange={(e) => setStatus(e.target.value as BikeStatus)}
      >
        {statuses.map((x) => (
          <option key={x} disabled={x === "Alugada" && !rented}>
            {x}
          </option>
        ))}
      </select>
      <select
        aria-label={"Localização do item " + bike.code}
        value={kiosk}
        disabled={rented}
        onChange={(e) => setKiosk(e.target.value)}
      >
        {kiosks.map((k) => (
          <option key={k.id} value={k.id}>
            {k.name}
          </option>
        ))}
      </select>
      {["Avariada", "Em manutenção"].includes(status) &&
        status !== bike.status && (
          <input
            className="fault-reason"
            placeholder="Descrição da avaria (opcional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      {canEditIdentity && (
        <details className="inventory-edit-details">
          <summary>Editar dados do item</summary>
          <div className="inventory-edit-grid">
            <label>
              Código
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Tipologia
              <select
                value={assetType}
                onChange={(e) => {
                  const next = e.target.value as AssetType;
                  const prefix = assetOptions.find((x) => x.value === next)?.prefix || "";
                  const number = code.match(/\d+$/)?.[0] || "001";
                  setAssetType(next);
                  setCode(prefix + number);
                }}
              >
                {assetOptions.map((x) => (
                  <option key={x.value} value={x.value}>{x.label}</option>
                ))}
              </select>
            </label>
            <label>
              Modelo/designação
              <input value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <label className="check inventory-active">
              <input
                type="checkbox"
                checked={active}
                disabled={rented}
                onChange={(e) => setActive(e.target.checked)}
              />
              Item ativo
            </label>
          </div>
          <small>
            Desativar retira o item da operação sem apagar o respetivo histórico.
          </small>
        </details>
      )}
      <button
        className="small-button"
        disabled={!changed || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await patch("/bikes/" + bike.id, {
              status,
              kiosk_id: kiosk,
              code,
              asset_type: assetType,
              model,
              active,
              fault_description: description,
            });
            onSaved();
          } catch (e) {
            notify((e as Error).message, "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "A guardar…" : "Guardar"}
      </button>
      <Link className="small-button secondary" to={"/frota/" + bike.id}>
        Ver ficha
      </Link>
    </div>
  );
}
function BikeCreateForm({
  kiosks,
  onCreated,
  onCancel,
}: {
  kiosks: Kiosk[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const { notify } = useFeedback();
  const [assetType, setAssetType] = useState<AssetType>("conventional"),
    [number, setNumber] = useState(""),
    [model, setModel] = useState(""),
    [kiosk, setKiosk] = useState(kiosks[0]?.id || ""),
    [busy, setBusy] = useState(false);
  return (
    <section className="card form compact-form">
      <h2>Adicionar item</h2>
      <div className="form-grid">
        <label>
          Tipo
          <select
            value={assetType}
            onChange={(e) => setAssetType(e.target.value as AssetType)}
          >
            {assetOptions.map((x) => (
              <option key={x.value} value={x.value}>
                {x.prefix} — {x.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Número
          <input
            inputMode="numeric"
            placeholder="001"
            value={number}
            onChange={(e) =>
              setNumber(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
          />
          <small>
            O código será{" "}
            {assetOptions.find((x) => x.value === assetType)?.prefix}
            {number.padStart(3, "0") || "001"}.
          </small>
        </label>
        <label>
          Modelo
          <input
            placeholder={assetOptions.find((x) => x.value === assetType)?.model}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <label>
          Localização
          <select value={kiosk} onChange={(e) => setKiosk(e.target.value)}>
            {kiosks.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="actions">
        <button
          className="primary"
          disabled={!number || !kiosk || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await post("/bikes", {
                asset_type: assetType,
                number,
                model,
                kiosk_id: kiosk,
              });
              onCreated();
            } catch (e) {
              notify((e as Error).message, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "A guardar…" : "Criar item"}
        </button>
        <button className="secondary" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </section>
  );
}
function FleetSummary({
  bikes,
  kiosks,
  canExport,
  hideOutOfService,
}: {
  bikes: Bike[];
  kiosks: Kiosk[];
  canExport: boolean;
  hideOutOfService: boolean;
}) {
  const { notify } = useFeedback();
  const visibleStatuses = statuses;
  const active = bikes.filter((b) => b.active !== false),
    electric = active.filter((b) => assetTypeOf(b) === "electric"),
    conventional = active.filter((b) => assetTypeOf(b) === "conventional"),
    child = active.filter((b) => assetTypeOf(b) === "child"),
    accessories = active.filter((b) => !isBicycle(b)),
    available = active.filter((b) => b.status === "Disponível").length,
    out = active.filter((b) =>
      ["Avariada", "Em manutenção", "Indisponível"].includes(b.status),
    ).length,
    rate = active.length ? Math.round((available / active.length) * 100) : 0;
  const byStatus = (status: BikeStatus) => {
    const list = active.filter((b) => b.status === status);
    return {
      total: list.length,
      bicycles: list.filter(isBicycle).length,
      accessories: list.filter((b) => !isBicycle(b)).length,
    };
  };
  const locationTypes = [
    {
      key: "electric",
      label: "Elétricas",
      matches: (b: Bike) => assetTypeOf(b) === "electric",
    },
    {
      key: "conventional",
      label: "Convencionais",
      matches: (b: Bike) => assetTypeOf(b) === "conventional",
    },
    {
      key: "child",
      label: "Infantis",
      matches: (b: Bike) => assetTypeOf(b) === "child",
    },
    {
      key: "accessories",
      label: "Acessórios",
      matches: (b: Bike) => !isBicycle(b),
    },
  ];
  const byLocationAndType = (id: string, matches: (b: Bike) => boolean) => {
    const list = active.filter((b) => b.kiosk_id === id && matches(b));
    return {
      total: list.length,
      states: Object.fromEntries(
        visibleStatuses.map((s) => [
          s,
          list.filter((b) => b.status === s).length,
        ]),
      ),
    };
  };
  return (
    <section className="fleet-summary">
      {canExport && (
        <div className="summary-tools">
          <button
            className="secondary"
            onClick={async () => {
              try {
                const report = await api<{
                  bikes: Array<
                    Bike & {
                      rental_count: number;
                      fault_count: number;
                      last_maintenance_at?: string;
                    }
                  >;
                }>("/bikes/report");
                exportCSV(
                  "frota-completa.csv",
                  [
                    "Código",
                    "Tipo",
                    "Modelo",
                    "Estado",
                    "Localização",
                    "Alugueres",
                    "Avarias",
                    "Última manutenção",
                    "Ativa",
                  ],
                  report.bikes.map((b) => [
                    b.code,
                    assetLabel(b),
                    b.model,
                    b.status,
                    b.kiosk?.name,
                    b.rental_count,
                    b.fault_count,
                    fmt(b.last_maintenance_at),
                    b.active ? "Sim" : "Não",
                  ]),
                );
              } catch (e) {
                notify((e as Error).message, "error");
              }
            }}
          >
            Exportar frota completa
          </button>
        </div>
      )}
      <div className="fleet-kpis">
        <div className="card">
          <span>Total do inventário</span>
          <b>{active.length}</b>
        </div>
        <div className="card">
          <span>Elétricas</span>
          <b>{electric.length}</b>
        </div>
        <div className="card">
          <span>Convencionais</span>
          <b>{conventional.length}</b>
        </div>
        <div className="card">
          <span>Infantis</span>
          <b>{child.length}</b>
        </div>
        <div className="card">
          <span>Acessórios</span>
          <b>{accessories.length}</b>
        </div>
        <div className="card">
          <span>Disponibilidade</span>
          <b>{rate}%</b>
          <small>{available} itens disponíveis</small>
        </div>
        {!hideOutOfService && (
          <div className="card alert-kpi">
            <span>Fora de serviço</span>
            <b>{out}</b>
            <small>Avariadas, em manutenção ou indisponíveis</small>
          </div>
        )}
      </div>
      <div className="fleet-summary-grid">
        <section className="card">
          <h2>Por estado</h2>
          <div className="summary-head">
            <span>Estado</span>
            <span>Bicicletas</span>
            <span>Acessórios</span>
            <span>Total</span>
          </div>
          {visibleStatuses.map((s) => {
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
        <section className="card location-status-card">
          <h2>Por localização, tipologia e estado</h2>
          <p className="muted">
            Cada localização apresenta separadamente as bicicletas elétricas,
            convencionais, infantis e os acessórios.
          </p>
          <div className="table-wrap location-table-wrap">
            <table className="location-state-table">
              <thead>
                <tr>
                  <th>Localização</th>
                  <th>Tipologia</th>
                  {visibleStatuses.map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {kiosks.flatMap((k) =>
                  locationTypes.map((type, index) => {
                    const c = byLocationAndType(k.id, type.matches);
                    return (
                      <tr
                        className="location-type-row"
                        key={`${k.id}-${type.key}`}
                      >
                        {index === 0 && (
                          <td
                            className="location-name-cell"
                            rowSpan={locationTypes.length}
                          >
                            <b>{k.name}</b>
                          </td>
                        )}
                        <td>{type.label}</td>
                        {visibleStatuses.map((s) => (
                          <td key={s}>{c.states[s]}</td>
                        ))}
                        <td>
                          <b>{c.total}</b>
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}
export function Fleet({ user }: { user: User }) {
  const canManage = ["admin", "manutencao"].includes(user.role);
  const [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [kiosk, setKiosk] = useState(""),
    [type, setType] = useState(""),
    [showAdd, setShowAdd] = useState(false),
    [refresh, setRefresh] = useState(0);
  const { data, error } = useLoad<{ bikes: Bike[]; kiosks: Kiosk[] }>(
    "/bikes",
    refresh,
  );
  const list = useMemo(
    () =>
      data?.bikes.filter(
        (b) =>
          (!q ||
            (b.code + " " + b.model).toLowerCase().includes(q.toLowerCase())) &&
          (!status || b.status === status) &&
          (!kiosk || b.kiosk_id === kiosk) &&
          (!type || assetTypeOf(b) === type),
      ) || [],
    [data, q, status, kiosk, type],
  );
  return (
    <>
      <div className="title">
        <div>
          <h1>Frota e equipamentos</h1>
          <p>{list.length} itens visíveis</p>
        </div>
        {user.role === "admin" && (
          <button className="primary" onClick={() => setShowAdd(!showAdd)}>
            Adicionar item
          </button>
        )}
      </div>
      {showAdd && (
        <BikeCreateForm
          kiosks={data?.kiosks || []}
          onCreated={() => {
            setShowAdd(false);
            setRefresh((x) => x + 1);
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}
      <FleetSummary
        bikes={data?.bikes || []}
        kiosks={data?.kiosks || []}
        canExport={user.role === "admin"}
        hideOutOfService={user.role === "funcionario"}
      />
      <div className="filters">
        <input
          placeholder="Pesquisar código ou modelo"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Todos os tipos</option>
          {assetOptions.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os estados</option>
          {statuses.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select value={kiosk} onChange={(e) => setKiosk(e.target.value)}>
          <option value="">Todos os quiosques</option>
          {data?.kiosks.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Tipo</th>
              <th>Modelo</th>
              {canManage ? (
                <th>Estado e localização</th>
              ) : (
                <>
                  <th>Estado</th>
                  <th>Localização</th>
                </>
              )}
              <th>Atualização</th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td>
                  <b>{b.code}</b>
                  {b.active === false && (
                    <small className="block-meta">Desativado</small>
                  )}
                </td>
                <td>{assetLabel(b)}</td>
                <td>{b.model}</td>
                {canManage ? (
                  <td>
                    <BikeAdminControls
                      bike={b}
                      kiosks={data?.kiosks || []}
                      canEditIdentity={user.role === "admin"}
                      onSaved={() => setRefresh((x) => x + 1)}
                    />
                  </td>
                ) : (
                  <>
                    <td>
                      <Badge>{b.status}</Badge>
                    </td>
                    <td>{b.kiosk?.name}</td>
                  </>
                )}
                <td>{fmt(b.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
export function RentalSummary({
  rentals,
  kiosks,
  summary,
}: {
  rentals: Rental[];
  kiosks: Kiosk[];
  summary?: {
    completed_today: number;
    completed_week: number;
    completed_month: number;
    completed_all: number;
  };
}) {
  const open = rentals.filter((r) => r.status === "Em aberto"),
    items = open.flatMap((r) => r.items.filter((i) => !i.returned_at)),
    electric = items.filter((i) => assetTypeOf(i.bike) === "electric").length,
    conventional = items.filter(
      (i) => assetTypeOf(i.bike) === "conventional",
    ).length,
    child = items.filter((i) => assetTypeOf(i.bike) === "child").length,
    accessories = items.filter((i) => !isBicycle(i.bike)).length,
    dateKey = (d: string | Date) =>
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon" }).format(
        new Date(d),
      ),
    today = dateKey(new Date()),
    localDay = new Date(today + "T00:00:00Z"),
    monday = new Date(localDay);
  monday.setUTCDate(localDay.getUTCDate() - ((localDay.getUTCDay() + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10),
    month = today.slice(0, 7),
    completed = rentals.filter(
      (r) => r.status === "Concluído" && r.returned_at,
    ),
    completedToday = summary?.completed_today ?? completed.filter(
      (r) => dateKey(r.returned_at!) === today,
    ).length,
    completedWeek = summary?.completed_week ?? completed.filter(
      (r) => dateKey(r.returned_at!) >= weekStart,
    ).length,
    completedMonth = summary?.completed_month ?? completed.filter((r) =>
      dateKey(r.returned_at!).startsWith(month),
    ).length,
    completedAll = summary?.completed_all ?? completed.length;
  const byKiosk = (id: string) => {
    const list = open
      .filter((r) => r.start_kiosk_id === id)
      .flatMap((r) => r.items.filter((i) => !i.returned_at));
    return {
      total: list.length,
      bicycles: list.filter((i) => isBicycle(i.bike)).length,
      accessories: list.filter((i) => !isBicycle(i.bike)).length,
    };
  };
  return (
    <section className="fleet-summary rental-summary">
      <div className="fleet-kpis rental-kpis">
        <div className="card">
          <span>Alugueres em aberto</span>
          <b>{open.length}</b>
        </div>
        <div className="card">
          <span>Itens atualmente alugados</span>
          <b>{items.length}</b>
        </div>
        <div className="card">
          <span>Elétricas alugadas</span>
          <b>{electric}</b>
        </div>
        <div className="card">
          <span>Convencionais alugadas</span>
          <b>{conventional}</b>
        </div>
        <div className="card">
          <span>Infantis alugadas</span>
          <b>{child}</b>
        </div>
        <div className="card">
          <span>Acessórios alugados</span>
          <b>{accessories}</b>
        </div>
        <div className="card period-kpi">
          <span>Concluídos hoje</span>
          <b>{completedToday}</b>
        </div>
        <div className="card period-kpi">
          <span>Concluídos esta semana</span>
          <b>{completedWeek}</b>
        </div>
        <div className="card period-kpi">
          <span>Concluídos este mês</span>
          <b>{completedMonth}</b>
        </div>
        <div className="card period-kpi">
          <span>Concluídos desde o início</span>
          <b>{completedAll}</b>
        </div>
      </div>
      <section className="card rental-location-summary">
        <h2>Itens alugados por quiosque de saída</h2>
        <div className="summary-head">
          <span>Quiosque</span>
          <span>Bicicletas</span>
          <span>Acessórios</span>
          <span>Total</span>
        </div>
        {kiosks.map((k) => {
          const c = byKiosk(k.id);
          return (
            <div className="summary-row" key={k.id}>
              <span>{k.name}</span>
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

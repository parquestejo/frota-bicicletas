import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, post, patch } from "./api";
import { AdminDashboard } from "./AdminDashboard";
import type {
  AssetType,
  Bike,
  BikeStatus,
  Fault,
  Kiosk,
  Rental,
  RentalDiscrepancy,
  RentalItem,
  User,
} from "./types";
const statuses: BikeStatus[] = [
  "Disponível",
  "Alugada",
  "Avariada",
  "Em manutenção",
  "Indisponível",
];
const operationalStatuses: BikeStatus[] = ["Disponível", "Alugada"];
const assetOptions: {
  value: AssetType;
  label: string;
  prefix: string;
  model: string;
}[] = [
  {
    value: "electric",
    label: "Bicicleta elétrica",
    prefix: "E",
    model: "Bicicleta elétrica",
  },
  {
    value: "conventional",
    label: "Bicicleta convencional",
    prefix: "C",
    model: "Bicicleta convencional",
  },
  {
    value: "child",
    label: "Bicicleta de criança",
    prefix: "I",
    model: "Bicicleta infantil",
  },
  { value: "helmet", label: "Capacete", prefix: "CAP", model: "Capacete" },
  { value: "lock", label: "Cadeado", prefix: "CAD", model: "Cadeado" },
  {
    value: "stroller",
    label: "Carrinho de bebé",
    prefix: "CAR",
    model: "Carrinho de bebé",
  },
];
const assetTypeOf = (b?: Bike): AssetType =>
  b?.asset_type || (b?.code.startsWith("E") ? "electric" : "conventional");
const assetLabel = (b?: Bike) =>
  assetOptions.find((x) => x.value === assetTypeOf(b))?.label || "Item";
const isBicycle = (b?: Bike) =>
  ["electric", "conventional", "child"].includes(assetTypeOf(b));
const fmt = (d?: string) =>
  d
    ? new Intl.DateTimeFormat("pt-PT", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Lisbon",
      }).format(new Date(d))
    : "—";
const dayKey = (d: string | Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon" }).format(
    new Date(d),
  );
const inDateRange = (d: string | undefined, from: string, to: string) =>
  !!d && (!from || dayKey(d) >= from) && (!to || dayKey(d) <= to);
const daysSince = (d: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));
function DateRange({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div className="date-range">
      <label>
        De
        <input
          type="date"
          value={from}
          onChange={(e) => onFrom(e.target.value)}
        />
      </label>
      <label>
        Até
        <input type="date" value={to} onChange={(e) => onTo(e.target.value)} />
      </label>
      {(from || to) && (
        <button
          className="text"
          onClick={() => {
            onFrom("");
            onTo("");
          }}
        >
          Limpar datas
        </button>
      )}
    </div>
  );
}
const csvCell = (v: unknown) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
function exportCSV(filename: string, headers: string[], rows: unknown[][]) {
  const csv =
    "\ufeff" +
    [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
const Badge = ({ children }: { children: string }) => (
  <span
    className={
      "badge s-" +
      children
        .toLowerCase()
        .replace(/\s/g, "-")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
    }
  >
    {children}
  </span>
);
function useLoad<T>(path: string, refresh = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<T>(path)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [path, refresh]);
  return { data, error };
}
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
function BikeAdminControls({
  bike,
  kiosks,
  onSaved,
}: {
  bike: Bike;
  kiosks: Kiosk[];
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<BikeStatus>(bike.status),
    [kiosk, setKiosk] = useState(bike.kiosk_id),
    [busy, setBusy] = useState(false),
    [description, setDescription] = useState("");
  const changed = status !== bike.status || kiosk !== bike.kiosk_id;
  return (
    <div className="inline-edit">
      <select
        aria-label={"Estado do item " + bike.code}
        value={status}
        onChange={(e) => setStatus(e.target.value as BikeStatus)}
      >
        {statuses.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
      <select
        aria-label={"Localização do item " + bike.code}
        value={kiosk}
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
      <button
        className="small-button"
        disabled={!changed || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await patch("/bikes/" + bike.id, {
              status,
              kiosk_id: kiosk,
              fault_description: description,
            });
            onSaved();
          } catch (e) {
            alert((e as Error).message);
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
              alert((e as Error).message);
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
                alert((e as Error).message);
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
                </td>
                <td>{assetLabel(b)}</td>
                <td>{b.model}</td>
                {canManage ? (
                  <td>
                    <BikeAdminControls
                      bike={b}
                      kiosks={data?.kiosks || []}
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
function RentalSummary({
  rentals,
  kiosks,
}: {
  rentals: Rental[];
  kiosks: Kiosk[];
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
    completedToday = completed.filter(
      (r) => dateKey(r.returned_at!) === today,
    ).length,
    completedWeek = completed.filter(
      (r) => dateKey(r.returned_at!) >= weekStart,
    ).length,
    completedMonth = completed.filter((r) =>
      dateKey(r.returned_at!).startsWith(month),
    ).length;
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
          <b>{completed.length}</b>
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
function RentalCorrection({
  rental,
  availableBikes,
  onSaved,
}: {
  rental: Rental;
  availableBikes: Bike[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false),
    [bikeId, setBikeId] = useState(""),
    [showDiscrepancy, setShowDiscrepancy] = useState(false),
    [bikeCode, setBikeCode] = useState(""),
    [description, setDescription] = useState(""),
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
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeBike(item: RentalItem) {
    if (!confirm(`Remover o item ${item.bike?.code} deste aluguer?`)) return;
    setBusy(true);
    try {
      await post(`/rentals/${rental.id}/remove-bike`, {
        rental_item_id: item.id,
      });
      onSaved();
    } catch (e) {
      alert((e as Error).message);
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
      alert("Discrepância comunicada ao administrador.");
      onSaved();
    } catch (e) {
      alert((e as Error).message);
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
                <button
                  className="text danger-text"
                  disabled={
                    busy ||
                    rental.items.filter((x) => !x.returned_at).length <= 1
                  }
                  title={
                    rental.items.filter((x) => !x.returned_at).length <= 1
                      ? "Não é possível remover o último item."
                      : ""
                  }
                  onClick={() => removeBike(i)}
                >
                  Remover
                </button>
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
  const [refresh, setRefresh] = useState(0),
    [dateFrom, setDateFrom] = useState(""),
    [dateTo, setDateTo] = useState(""),
    [returning, setReturning] = useState<Rental | null>(null),
    [anomalies, setAnomalies] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  const { data, error } = useLoad<{
    rentals: Rental[];
    available_bikes: Bike[];
    kiosks: Kiosk[];
    discrepancies: RentalDiscrepancy[];
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
      alert((e as Error).message);
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
                {user.role === "admin" && (
                  <button
                    className="secondary"
                    onClick={async () => {
                      const resolution = prompt(
                        "Descreva como a discrepância foi resolvida:",
                      );
                      if (!resolution?.trim()) return;
                      try {
                        await patch(`/rental-discrepancies/${d.id}/resolve`, {
                          resolution,
                        });
                        setRefresh((x) => x + 1);
                      } catch (e) {
                        alert((e as Error).message);
                      }
                    }}
                  >
                    Marcar como resolvida
                  </button>
                )}
              </div>
            ))}
        </section>
      )}
      <h2>Concluídos</h2>
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

const faultStatuses = [
  "Aberta",
  "Em análise",
  "Em reparação",
  "Resolvida",
  "Cancelada",
];
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
                alert((e as Error).message);
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
export function Reports() {
  const rentalsLoad = useLoad<{ rentals: Rental[] }>("/rentals"),
    faultsLoad = useLoad<{ faults: Fault[] }>("/faults");
  const [tab, setTab] = useState<"rentals" | "faults">("rentals"),
    [dateFrom, setDateFrom] = useState(""),
    [dateTo, setDateTo] = useState("");
  const rentals = (rentalsLoad.data?.rentals || []).filter(
      (r) =>
        r.status === "Concluído" && inDateRange(r.started_at, dateFrom, dateTo),
    ),
    faults = (faultsLoad.data?.faults || []).filter((f) =>
      inDateRange(f.created_at, dateFrom, dateTo),
    );
  const rentalRows = rentals.flatMap((r) =>
    r.items.map((i) => [
      r.reference,
      r.customer_ref,
      i.bike?.code,
      assetLabel(i.bike),
      r.start_kiosk?.name,
      i.return_kiosk?.name,
      fmt(r.started_at),
      fmt(i.returned_at || r.returned_at),
      r.started_by_user?.full_name,
      i.returned_by_user?.full_name || r.returned_by_user?.full_name,
      i.anomaly ? "Sim" : "Não",
      i.anomaly_description || "",
    ]),
  );
  const faultRows = faults.map((f) => [
    f.bike?.code,
    assetLabel(f.bike),
    f.origin,
    f.category,
    f.description,
    f.severity,
    f.usable ? "Sim" : "Não",
    f.status,
    fmt(f.created_at),
    f.created_by_user?.full_name,
    f.notes || "",
  ]);
  return (
    <>
      <div className="title">
        <div>
          <h1>Relatórios</h1>
          <p>Consulta detalhada e exportação de dados</p>
        </div>
      </div>
      <div className="report-tabs">
        <button
          className={tab === "rentals" ? "primary" : "secondary"}
          onClick={() => setTab("rentals")}
        >
          Alugueres concluídos ({rentals.length})
        </button>
        <button
          className={tab === "faults" ? "primary" : "secondary"}
          onClick={() => setTab("faults")}
        >
          Avarias ({faults.length})
        </button>
      </div>
      <DateRange
        from={dateFrom}
        to={dateTo}
        onFrom={setDateFrom}
        onTo={setDateTo}
      />
      {(rentalsLoad.error || faultsLoad.error) && (
        <p className="error">{rentalsLoad.error || faultsLoad.error}</p>
      )}
      {tab === "rentals" ? (
        <>
          <div className="title report-title">
            <div>
              <h2>Alugueres concluídos</h2>
              <p>Uma linha por item devolvido.</p>
            </div>
            <button
              className="primary"
              onClick={() =>
                exportCSV(
                  "alugueres-concluidos.csv",
                  [
                    "Referência",
                    "Cliente",
                    "Item",
                    "Tipo",
                    "Quiosque de saída",
                    "Quiosque de devolução",
                    "Início",
                    "Devolução",
                    "Registado por",
                    "Devolvido por",
                    "Anomalia",
                    "Descrição da anomalia",
                  ],
                  rentalRows,
                )
              }
            >
              Exportar para Excel (CSV)
            </button>
          </div>
          <div className="table-wrap">
            <table className="wide-table">
              <thead>
                <tr>
                  <th>Referência</th>
                  <th>Cliente</th>
                  <th>Item</th>
                  <th>Tipo</th>
                  <th>Saída</th>
                  <th>Devolução</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th>Funcionários</th>
                  <th>Anomalia</th>
                </tr>
              </thead>
              <tbody>
                {rentals.flatMap((r) =>
                  r.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <b>{r.reference}</b>
                      </td>
                      <td>{r.customer_ref}</td>
                      <td>{i.bike?.code}</td>
                      <td>{assetLabel(i.bike)}</td>
                      <td>{r.start_kiosk?.name}</td>
                      <td>{i.return_kiosk?.name || "—"}</td>
                      <td>{fmt(r.started_at)}</td>
                      <td>{fmt(i.returned_at || r.returned_at)}</td>
                      <td>
                        {r.started_by_user?.full_name || "—"}
                        <br />
                        <small>
                          Devolução:{" "}
                          {i.returned_by_user?.full_name ||
                            r.returned_by_user?.full_name ||
                            "—"}
                        </small>
                      </td>
                      <td>
                        {i.anomaly ? i.anomaly_description || "Sim" : "Não"}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="title report-title">
            <div>
              <h2>Histórico de avarias</h2>
              <p>Inclui ocorrências abertas, em tratamento e concluídas.</p>
            </div>
            <button
              className="primary"
              onClick={() =>
                exportCSV(
                  "avarias.csv",
                  [
                    "Item",
                    "Tipo",
                    "Origem",
                    "Categoria",
                    "Descrição",
                    "Gravidade",
                    "Utilizável",
                    "Estado",
                    "Data",
                    "Registado por",
                    "Notas",
                  ],
                  faultRows,
                )
              }
            >
              Exportar para Excel (CSV)
            </button>
          </div>
          <div className="table-wrap">
            <table className="wide-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Tipo</th>
                  <th>Origem</th>
                  <th>Categoria</th>
                  <th>Descrição</th>
                  <th>Gravidade</th>
                  <th>Utilizável</th>
                  <th>Estado</th>
                  <th>Data</th>
                  <th>Registado por</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {faults.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <b>{f.bike?.code}</b>
                    </td>
                    <td>{assetLabel(f.bike)}</td>
                    <td>{f.origin}</td>
                    <td>{f.category}</td>
                    <td>{f.description}</td>
                    <td>{f.severity}</td>
                    <td>{f.usable ? "Sim" : "Não"}</td>
                    <td>
                      <Badge>{f.status}</Badge>
                    </td>
                    <td>{fmt(f.created_at)}</td>
                    <td>{f.created_by_user?.full_name || "—"}</td>
                    <td>{f.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
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
function UserAdminControls({
  user,
  kiosks,
  onSaved,
}: {
  user: User;
  kiosks: Kiosk[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false),
    [fullName, setFullName] = useState(user.full_name),
    [username, setUsername] = useState(user.username),
    [role, setRole] = useState(user.role),
    [kiosk, setKiosk] = useState(user.usual_kiosk_id || ""),
    [active, setActive] = useState(user.active),
    [busy, setBusy] = useState(false);
  return (
    <div className="user-controls">
      <button className="text" onClick={() => setOpen(!open)}>
        {open ? "Fechar" : "Editar"}
      </button>
      {open && (
        <div className="user-edit-panel">
          <h3>Editar utilizador</h3>
          <label>
            Nome completo
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </label>
          <label>
            Nome de utilizador
            <input
              autoCapitalize="none"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
            />
            <small>Letras, números, ponto, hífen ou sublinhado.</small>
          </label>
          <label>
            Perfil
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as User["role"])}
            >
              <option value="funcionario">Funcionário</option>
              <option value="manutencao">Manutenção</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
          <label>
            Quiosque habitual
            <select value={kiosk} onChange={(e) => setKiosk(e.target.value)}>
              <option value="">Sem quiosque definido</option>
              {kiosks.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />{" "}
            Conta ativa
          </label>
          <button
            className="primary full"
            disabled={busy || !fullName.trim() || !username.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await patch("/users/" + user.id, {
                  full_name: fullName,
                  username,
                  role,
                  usual_kiosk_id: kiosk || null,
                  active,
                });
                setOpen(false);
                onSaved();
              } catch (e) {
                alert((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "A guardar…" : "Guardar alterações"}
          </button>
          <button
            className="secondary full"
            onClick={async () => {
              const password = prompt(
                "Nova palavra-passe (mínimo 6 caracteres)",
              );
              if (!password) return;
              const confirm = prompt("Repita a nova palavra-passe");
              if (password !== confirm)
                return alert("As palavras-passe não são iguais.");
              try {
                await post("/users/" + user.id + "/password", { password });
                alert("Palavra-passe alterada.");
              } catch (e) {
                alert((e as Error).message);
              }
            }}
          >
            Redefinir palavra-passe
          </button>
        </div>
      )}
    </div>
  );
}
export function Users() {
  const [refresh, setRefresh] = useState(0);
  const { data, error } = useLoad<{ users: User[]; kiosks: Kiosk[] }>(
    "/users",
    refresh,
  );
  async function add() {
    const full_name = prompt("Nome do funcionário");
    if (!full_name) return;
    const username = prompt("Nome de utilizador");
    if (!username) return;
    const password = prompt("Palavra-passe inicial (mínimo 6 caracteres)");
    if (!password) return;
    const confirm = prompt("Repita a palavra-passe inicial");
    if (password !== confirm) return alert("As palavras-passe não são iguais.");
    const chosen = prompt(
      "Perfil: funcionario, manutencao ou admin",
      "funcionario",
    );
    const role =
      chosen === "admin"
        ? "admin"
        : chosen === "manutencao"
          ? "manutencao"
          : "funcionario";
    await post("/users", { full_name, username, password, role });
    setRefresh((x) => x + 1);
  }
  return (
    <>
      <div className="title">
        <div>
          <h1>Utilizadores</h1>
          <p>Contas e permissões</p>
        </div>
        <button className="primary" onClick={add}>
          Criar utilizador
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Utilizador</th>
              <th>Perfil</th>
              <th>Quiosque habitual</th>
              <th>Estado</th>
              <th>Último acesso</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id}>
                <td>{u.full_name}</td>
                <td>{u.username}</td>
                <td>
                  {u.role === "admin"
                    ? "Administrador"
                    : u.role === "manutencao"
                      ? "Manutenção"
                      : "Funcionário"}
                </td>
                <td>
                  {data.kiosks.find((k) => k.id === u.usual_kiosk_id)?.name ||
                    "—"}
                </td>
                <td>{u.active ? "Ativo" : "Inativo"}</td>
                <td>{fmt(u.last_login_at)}</td>
                <td>
                  <UserAdminControls
                    user={u}
                    kiosks={data.kiosks}
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

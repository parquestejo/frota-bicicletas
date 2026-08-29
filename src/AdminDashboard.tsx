type PeriodValue = { rentals: number; items: number };
type Period = {
  current: PeriodValue;
  previous: PeriodValue;
  revenue: number;
  previous_revenue: number;
};
type ManagementData = {
  periods: { today: Period; week: Period; month: Period };
  closures_recent: any[];
  recent_observations: any[];
  open_rentals: any[];
  pending_discrepancies: number;
  pending_faults: number;
  fleet_by_kiosk: any[];
};

const money = (v: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(
    Number(v || 0),
  );
const fmt = (v?: string) =>
  v
    ? new Intl.DateTimeFormat("pt-PT", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Lisbon",
      }).format(new Date(v))
    : "—";
const delta = (current: number, previous: number) =>
  previous === 0
    ? current === 0
      ? "Sem alteração"
      : `+${current}`
    : `${current >= previous ? "+" : ""}${Math.round(((current - previous) / previous) * 100)}%`;
const csv = (v: unknown) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
function exportManagement(data: ManagementData) {
  const rows: unknown[][] = [
    ["Área", "Indicador", "Período atual", "Período anterior", "Variação"],
  ];
  for (const [key, label] of [
    ["today", "Hoje"],
    ["week", "Esta semana"],
    ["month", "Este mês"],
  ] as const) {
    const p = data.periods[key];
    rows.push(
      [
        "Atividade",
        `Alugueres — ${label}`,
        p.current.rentals,
        p.previous.rentals,
        delta(p.current.rentals, p.previous.rentals),
      ],
      [
        "Atividade",
        `Itens — ${label}`,
        p.current.items,
        p.previous.items,
        delta(p.current.items, p.previous.items),
      ],
      [
        "Receita",
        `Multibanco — ${label}`,
        p.revenue.toFixed(2),
        p.previous_revenue.toFixed(2),
        delta(p.revenue, p.previous_revenue),
      ],
    );
  }
  rows.push(
    [],
    [
      "Últimos fechos",
      "Data",
      "Quiosque",
      "Funcionário",
      "Alugueres",
      "Bicicletas",
      "Acessórios",
      "Multibanco",
      "Observações",
    ],
  );
  data.closures_recent.forEach((c) =>
    rows.push([
      "Fecho",
      c.report_date,
      c.kiosk?.name,
      c.user?.full_name,
      c.rental_count,
      c.bike_count,
      c.accessory_count,
      Number(c.card_total || 0).toFixed(2),
      c.observations || "",
    ]),
  );
  rows.push(
    [],
    [
      "Inventário",
      "Quiosque",
      "Total",
      "Disponíveis",
      "Alugados",
    ],
  );
  data.fleet_by_kiosk.forEach((k) =>
    rows.push([
      "Inventário",
      k.name,
      k.total,
      k.by_status["Disponível"],
      k.by_status["Alugada"],
    ]),
  );
  const content = "\ufeff" + rows.map((r) => r.map(csv).join(";")).join("\r\n"),
    link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  link.download = "dashboard-gestao.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function PeriodCard({ title, value }: { title: string; value: Period }) {
  return (
    <article className="card management-period">
      <span>{title}</span>
      <b>{value.current.rentals}</b>
      <small>alugueres · {value.current.items} itens</small>
      <div>
        <strong>{money(value.revenue)}</strong> Multibanco
      </div>
      <small
        className={
          value.current.rentals >= value.previous.rentals
            ? "positive-change"
            : "negative-change"
        }
      >
        {delta(value.current.rentals, value.previous.rentals)} face ao período
        anterior
      </small>
    </article>
  );
}

export function AdminDashboard({ data }: { data?: ManagementData | null }) {
  if (!data) return null;
  return (
    <section className="admin-management">
      <div className="title management-title">
        <div>
          <h2>Informação de gestão</h2>
          <p>Atividade, receita declarada e situação operacional</p>
        </div>
        <button className="secondary" onClick={() => exportManagement(data)}>
          Exportar para Excel (CSV)
        </button>
      </div>
      <div className="management-periods">
        <PeriodCard title="Hoje" value={data.periods.today} />
        <PeriodCard title="Esta semana" value={data.periods.week} />
        <PeriodCard title="Este mês" value={data.periods.month} />
        <article className="card management-alerts">
          <span>Situação atual</span>
          <div className="row">
            <span>Alugueres em aberto</span>
            <b>{data.open_rentals.length}</b>
          </div>
          <div className="row">
            <span>Avarias pendentes</span>
            <b>{data.pending_faults}</b>
          </div>
          <div className="row">
            <span>Discrepâncias pendentes</span>
            <b>{data.pending_discrepancies}</b>
          </div>
        </article>
      </div>
      <section className="card management-block">
        <div className="title compact-title">
          <div>
            <h3>Últimos relatórios de final de dia</h3>
            <p>Os três relatórios mais recentes de cada quiosque</p>
          </div>
          <strong>3 por quiosque</strong>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quiosque</th>
                <th>Data</th>
                <th>Funcionário</th>
                <th>Alugueres</th>
                <th>Bicicletas</th>
                <th>E / C / I</th>
                <th>Acessórios</th>
                <th>Multibanco</th>
                <th>Observações</th>
                <th>Talão</th>
              </tr>
            </thead>
            <tbody>
              {data.closures_recent.length ? (
                data.closures_recent.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <b>{c.kiosk?.name}</b>
                    </td>
                    <td>{c.report_date}</td>
                    <td>{c.user?.full_name}</td>
                    <td>{c.rental_count}</td>
                    <td>{c.bike_count}</td>
                    <td>
                      {c.electric_count} / {c.conventional_count} /{" "}
                      {c.child_count}
                    </td>
                    <td>{c.accessory_count}</td>
                    <td>{money(c.card_total)}</td>
                    <td>{c.observations || "—"}</td>
                    <td>
                      {c.receipt_path ? (
                        <a
                          className="text"
                          href={`/api/daily-closures/${c.id}/receipt`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ver talão
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10}>
                    Ainda não existem relatórios finais submetidos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <div className="grid2">
        <section className="card management-block">
          <h3>Inventário operacional por quiosque</h3>
          <p className="muted">Apenas itens disponíveis ou alugados.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Quiosque</th>
                  <th>E</th>
                  <th>C</th>
                  <th>I</th>
                  <th>Acess.</th>
                  <th>Disp.</th>
                  <th>Alug.</th>
                </tr>
              </thead>
              <tbody>
                {data.fleet_by_kiosk.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <b>{k.name}</b>
                    </td>
                    <td>{k.by_type.electric}</td>
                    <td>{k.by_type.conventional}</td>
                    <td>{k.by_type.child}</td>
                    <td>{k.by_type.accessories}</td>
                    <td>{k.by_status["Disponível"]}</td>
                    <td>{k.by_status["Alugada"]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card management-block">
          <h3>Alugueres em aberto</h3>
          {data.open_rentals.length ? (
            data.open_rentals.slice(0, 8).map((r) => (
              <div className="row" key={r.id}>
                <span>
                  <b>{r.reference}</b> · {r.start_kiosk?.name}
                  <small className="block-meta">
                    {r.customer_ref} · {r.started_by_user?.full_name}
                  </small>
                  {r.customer_contact && (
                    <small className="block-meta">
                      Contacto: {" "}
                      <a href={`tel:${r.customer_contact}`}>
                        {r.customer_contact}
                      </a>
                    </small>
                  )}
                </span>
                <small>{fmt(r.started_at)}</small>
              </div>
            ))
          ) : (
            <p className="muted">Sem alugueres em aberto.</p>
          )}
        </section>
      </div>
      {data.recent_observations.length > 0 && (
        <section className="card management-block">
          <h3>Observações recentes dos fechos</h3>
          {data.recent_observations.map((c) => (
            <div className="row observation-row" key={c.id}>
              <span>
                <b>{c.kiosk?.name}</b> · {c.user?.full_name}
                <small className="block-meta">{c.observations}</small>
              </span>
              <small>{c.report_date}</small>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}

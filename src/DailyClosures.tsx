import { useEffect, useMemo, useState } from "react";
import { api, patch, post } from "./api";
import type { DailyClosure, Kiosk, User } from "./types";

const todayLisbon = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon" }).format(
    new Date(),
  );
const money = (value: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(
    Number(value || 0),
  );
const dateTime = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("pt-PT", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Lisbon",
      }).format(new Date(value))
    : "—";
const csvCell = (value: unknown) =>
  '"' + String(value ?? "").replace(/"/g, '""') + '"';
function exportCSV(rows: DailyClosure[]) {
  const headers = [
    "Data",
    "Quiosque",
    "Vigilante",
    "Utilizador",
    "Alugueres",
    "Bicicletas",
    "Elétricas",
    "Convencionais",
    "Multibanco",
    "Estado",
    "Submetido em",
    "Observações",
  ];
  const body = rows.map((x) => [
    x.report_date,
    x.kiosk?.name,
    x.user?.full_name,
    x.user?.username,
    x.rental_count,
    x.bike_count,
    x.electric_count,
    x.conventional_count,
    Number(x.card_total).toFixed(2),
    x.status,
    dateTime(x.submitted_at),
    x.observations || "",
  ]);
  const csv =
    "\ufeff" +
    [headers, ...body].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  link.download = "fechos-diarios.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}
function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error("Não foi possível ler o ficheiro."));
    reader.readAsDataURL(file);
  });
}
type Stats = {
  rental_count: number;
  bike_count: number;
  electric_count: number;
  conventional_count: number;
};
const emptyStats: Stats = {
  rental_count: 0,
  bike_count: 0,
  electric_count: 0,
  conventional_count: 0,
};

export function DailyClosures({ user }: { user: User }) {
  const [data, setData] = useState<{
      closures: DailyClosure[];
      kiosks: Kiosk[];
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reportDate, setReportDate] = useState(todayLisbon()),
    [kioskId, setKioskId] = useState(user.usual_kiosk_id || ""),
    [cardTotal, setCardTotal] = useState(""),
    [observations, setObservations] = useState(""),
    [receipt, setReceipt] = useState<File | null>(null),
    [stats, setStats] = useState<Stats>(emptyStats),
    [dateFrom, setDateFrom] = useState(""),
    [dateTo, setDateTo] = useState(""),
    [kioskFilter, setKioskFilter] = useState("");
  async function load() {
    try {
      setData(await api("/daily-closures"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (data && !kioskId)
      setKioskId(user.usual_kiosk_id || data.kiosks[0]?.id || "");
  }, [data, kioskId, user.usual_kiosk_id]);
  const ownExisting = useMemo(
    () =>
      data?.closures.find(
        (x) =>
          x.report_date === reportDate &&
          x.kiosk_id === kioskId &&
          x.user_id === user.id,
      ),
    [data, reportDate, kioskId, user.id],
  );
  useEffect(() => {
    setCardTotal(ownExisting ? String(ownExisting.card_total) : "");
    setObservations(ownExisting?.observations || "");
    setReceipt(null);
  }, [ownExisting?.id, reportDate, kioskId]);
  useEffect(() => {
    if (!reportDate || !kioskId) {
      setStats(emptyStats);
      return;
    }
    api<{ stats: Stats }>(
      `/daily-closures/stats?date=${encodeURIComponent(reportDate)}&kiosk_id=${encodeURIComponent(kioskId)}`,
    )
      .then((x) => setStats(x.stats))
      .catch((e) => setError(e.message));
  }, [reportDate, kioskId]);
  const visible = useMemo(
    () =>
      data?.closures.filter(
        (x) =>
          (!dateFrom || x.report_date >= dateFrom) &&
          (!dateTo || x.report_date <= dateTo) &&
          (!kioskFilter || x.kiosk_id === kioskFilter),
      ) || [],
    [data, dateFrom, dateTo, kioskFilter],
  );
  async function save(status: "Rascunho" | "Submetido") {
    setError("");
    if (!reportDate || !kioskId)
      return setError("Indique a data e o quiosque.");
    if (cardTotal === "" || Number(cardTotal) < 0)
      return setError("Indique o valor total recebido em Multibanco.");
    if (status === "Submetido" && !receipt && !ownExisting?.receipt_path)
      return setError("Anexe o talão de fecho de caixa antes de submeter.");
    setBusy(true);
    try {
      const receiptPayload = receipt
        ? {
            name: receipt.name,
            type: receipt.type,
            data: await fileData(receipt),
          }
        : undefined;
      await post("/daily-closures", {
        report_date: reportDate,
        kiosk_id: kioskId,
        card_total: Number(cardTotal),
        observations,
        status,
        receipt: receiptPayload,
      });
      await load();
      setReceipt(null);
      alert(
        status === "Submetido"
          ? "Fecho diário submetido com sucesso."
          : "Rascunho guardado.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const locked = ownExisting?.status === "Submetido";
  return (
    <>
      <div className="title">
        <div>
          <h1>Fecho diário</h1>
          <p>Relatório de final de dia do quiosque</p>
        </div>
        {user.role === "admin" && (
          <button className="secondary" onClick={() => exportCSV(visible)}>
            Exportar para Excel (CSV)
          </button>
        )}
      </div>
      <section className="card closure-form">
        <div className="form-grid">
          <label>
            Vigilante
            <input value={user.full_name} disabled />
          </label>
          <label>
            Data
            <input
              type="date"
              max={todayLisbon()}
              value={reportDate}
              disabled={locked}
              onChange={(e) => setReportDate(e.target.value)}
            />
          </label>
          <label>
            Quiosque
            <select
              value={kioskId}
              disabled={locked}
              onChange={(e) => setKioskId(e.target.value)}
            >
              <option value="">Selecionar…</option>
              {data?.kiosks.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Estado
            <input value={ownExisting?.status || "Novo"} disabled />
          </label>
        </div>
        <div className="closure-stats">
          <div>
            <span>Alugueres</span>
            <b>{stats.rental_count}</b>
          </div>
          <div>
            <span>Bicicletas alugadas</span>
            <b>{stats.bike_count}</b>
          </div>
          <div>
            <span>Elétricas</span>
            <b>{stats.electric_count}</b>
          </div>
          <div>
            <span>Convencionais</span>
            <b>{stats.conventional_count}</b>
          </div>
        </div>
        <div className="form-grid closure-manual-fields">
          <label>
            Valor total recebido em Multibanco (€)
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={cardTotal}
              disabled={locked}
              onChange={(e) => setCardTotal(e.target.value)}
            />
          </label>
          <label>
            Talão de fecho de caixa
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={locked}
              onChange={(e) => setReceipt(e.target.files?.[0] || null)}
            />
            <small>
              JPG, PNG, WebP ou PDF, até 5 MB.
              {ownExisting?.receipt_path ? " Já existe um talão guardado." : ""}
            </small>
          </label>
        </div>
        <label>
          Observações (opcional)
          <textarea
            value={observations}
            disabled={locked}
            onChange={(e) => setObservations(e.target.value)}
          />
        </label>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {locked ? (
          <div className="success">
            Fecho submetido em {dateTime(ownExisting?.submitted_at)}. Apenas um
            administrador o pode reabrir.
          </div>
        ) : (
          <div className="actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => save("Rascunho")}
            >
              {busy ? "A guardar…" : "Guardar rascunho"}
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => save("Submetido")}
            >
              {busy ? "A submeter…" : "Submeter fecho"}
            </button>
          </div>
        )}
      </section>
      <div className="title section-title">
        <div>
          <h2>
            {user.role === "admin" ? "Todos os fechos" : "Os meus fechos"}
          </h2>
          <p>Histórico dos relatórios de final de dia</p>
        </div>
      </div>
      <div className="filters">
        <label>
          De
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        {user.role === "admin" && (
          <label>
            Quiosque
            <select
              value={kioskFilter}
              onChange={(e) => setKioskFilter(e.target.value)}
            >
              <option value="">Todos</option>
              {data?.kiosks.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="table-wrap">
        <table className="wide-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Quiosque</th>
              {user.role === "admin" && <th>Vigilante</th>}
              <th>Alugueres</th>
              <th>Bicicletas</th>
              <th>E / C</th>
              <th>Multibanco</th>
              <th>Estado</th>
              <th>Talão</th>
              {user.role === "admin" && <th>Ação</th>}
            </tr>
          </thead>
          <tbody>
            {visible.length ? (
              visible.map((x) => (
                <tr key={x.id}>
                  <td>
                    <b>{x.report_date}</b>
                  </td>
                  <td>{x.kiosk?.name}</td>
                  {user.role === "admin" && (
                    <td>
                      {x.user?.full_name}
                      <small className="block-meta">{x.user?.username}</small>
                    </td>
                  )}
                  <td>{x.rental_count}</td>
                  <td>{x.bike_count}</td>
                  <td>
                    {x.electric_count} / {x.conventional_count}
                  </td>
                  <td>{money(x.card_total)}</td>
                  <td>
                    <span
                      className={
                        "badge " +
                        (x.status === "Submetido"
                          ? "s-resolvida"
                          : "s-em-analise")
                      }
                    >
                      {x.status}
                    </span>
                  </td>
                  <td>
                    {x.receipt_path ? (
                      <a
                        className="text"
                        href={`/api/daily-closures/${x.id}/receipt`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver talão
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  {user.role === "admin" && (
                    <td>
                      {x.status === "Submetido" ? (
                        <button
                          className="text"
                          onClick={async () => {
                            if (
                              !confirm(
                                "Reabrir este fecho para permitir correções?",
                              )
                            )
                              return;
                            try {
                              await patch(`/daily-closures/${x.id}/reopen`, {});
                              await load();
                            } catch (e) {
                              alert((e as Error).message);
                            }
                          }}
                        >
                          Reabrir
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={user.role === "admin" ? 10 : 8}>
                  Sem fechos registados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

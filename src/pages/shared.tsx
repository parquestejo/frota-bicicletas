import { useEffect, useState } from "react";
import { api } from "../api";
import type { AssetType, Bike, BikeStatus } from "../types";

export const statuses: BikeStatus[] = [
  "Disponível", "Alugada", "Avariada", "Em manutenção", "Indisponível",
];
export const operationalStatuses: BikeStatus[] = ["Disponível", "Alugada"];
export const assetOptions: { value: AssetType; label: string; prefix: string; model: string }[] = [
  { value: "electric", label: "Bicicleta elétrica", prefix: "E", model: "Bicicleta elétrica" },
  { value: "conventional", label: "Bicicleta convencional", prefix: "C", model: "Bicicleta convencional" },
  { value: "child", label: "Bicicleta de criança", prefix: "I", model: "Bicicleta infantil" },
  { value: "helmet", label: "Capacete", prefix: "CAP", model: "Capacete" },
  { value: "lock", label: "Cadeado", prefix: "CAD", model: "Cadeado" },
  { value: "stroller", label: "Carrinho de bebé", prefix: "CAR", model: "Carrinho de bebé" },
];
export const assetTypeOf = (bike?: Bike): AssetType =>
  bike?.asset_type || (bike?.code.startsWith("E") ? "electric" : "conventional");
export const assetLabel = (bike?: Bike) =>
  assetOptions.find((item) => item.value === assetTypeOf(bike))?.label || "Item";
export const isBicycle = (bike?: Bike) =>
  ["electric", "conventional", "child"].includes(assetTypeOf(bike));
export const fmt = (date?: string) => date
  ? new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Lisbon" }).format(new Date(date))
  : "—";
export const dayKey = (date: string | Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon" }).format(new Date(date));
export const inDateRange = (date: string | undefined, from: string, to: string) =>
  !!date && (!from || dayKey(date) >= from) && (!to || dayKey(date) <= to);
export const daysSince = (date: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000));

export function DateRange({ from, to, onFrom, onTo }: {
  from: string; to: string; onFrom: (value: string) => void; onTo: (value: string) => void;
}) {
  return <div className="date-range">
    <label>De<input type="date" value={from} onChange={(event) => onFrom(event.target.value)} /></label>
    <label>Até<input type="date" value={to} onChange={(event) => onTo(event.target.value)} /></label>
    {(from || to) && <button type="button" className="text" onClick={() => { onFrom(""); onTo(""); }}>Limpar datas</button>}
  </div>;
}

const csvCell = (raw: unknown) => {
  const value = String(raw ?? "");
  const safe = /^[=+\-@]/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
};
export function exportCSV(filename: string, headers: string[], rows: unknown[][]) {
  const csv = "\ufeff" + [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
export const Badge = ({ children }: { children: string }) => <span className={
  "badge s-" + children.toLowerCase().replace(/\s/g, "-").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}>{children}</span>;

export function useLoad<T>(path: string, refresh = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<T>(path).then(setData).catch((reason) => setError(reason.message));
  }, [path, refresh]);
  return { data, error };
}

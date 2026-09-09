import { readFileSync, writeFileSync } from "node:fs";
import { createRentalAnalyticsPdf } from "./reportPdf.mjs";

const report = {
  rental_count: 148, item_count: 231, revenue: 1284.5,
  average_duration_minutes: 96, busiest_weekday: "Sábado",
  stockout_days: 3, stockout_minutes: 275,
  paid_rental_count: 126, free_rental_count: 17, unclassified_rental_count: 5,
  busiest_days: [
    { local_date: "2026-08-22", rental_count: 24, item_count: 39, revenue: 198 },
    { local_date: "2026-08-15", rental_count: 21, item_count: 34, revenue: 172 },
    { local_date: "2026-08-08", rental_count: 19, item_count: 31, revenue: 155 },
    { local_date: "2026-08-29", rental_count: 18, item_count: 29, revenue: 148 },
  ],
  weekdays: [
    { weekday_number: 1, weekday: "Segunda-feira", rental_count: 11 },
    { weekday_number: 2, weekday: "Terça-feira", rental_count: 14 },
    { weekday_number: 3, weekday: "Quarta-feira", rental_count: 16 },
    { weekday_number: 4, weekday: "Quinta-feira", rental_count: 18 },
    { weekday_number: 5, weekday: "Sexta-feira", rental_count: 22 },
    { weekday_number: 6, weekday: "Sábado", rental_count: 42 },
    { weekday_number: 7, weekday: "Domingo", rental_count: 25 },
  ],
  kiosks: [
    { id: "1", name: "Praia da Torre", rental_count: 82, revenue: 714.5 },
    { id: "2", name: "Terrapleno de Algés", rental_count: 66, revenue: 570 },
  ],
  asset_types: [
    { asset_type: "electric", item_count: 103 }, { asset_type: "conventional", item_count: 78 },
    { asset_type: "child", item_count: 28 }, { asset_type: "helmet", item_count: 22 },
  ],
  stockouts: [
    { id: "1", kiosk_name: "Praia da Torre", started_at: "2026-08-22T14:05:00Z", ended_at: "2026-08-22T16:20:00Z", rented_count: 15, out_of_service_count: 0, cause: "Todas alugadas", duration_minutes: 135 },
    { id: "2", kiosk_name: "Terrapleno de Algés", started_at: "2026-08-15T12:10:00Z", ended_at: "2026-08-15T14:30:00Z", rented_count: 12, out_of_service_count: 3, cause: "Capacidade mista", duration_minutes: 140 },
  ],
};

const logo = `data:image/png;base64,${readFileSync(new URL("../../public/parques-tejo-logo.png", import.meta.url)).toString("base64")}`;
const bytes = createRentalAnalyticsPdf(report, "2026-08-01", "2026-08-31", logo).output("arraybuffer");
writeFileSync(new URL("./relatorio-amostra.pdf", import.meta.url), Buffer.from(bytes));

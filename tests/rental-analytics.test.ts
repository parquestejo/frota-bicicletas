import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { apiSource, pageSource } from "./project-source";

const migration = readFileSync(new URL("../supabase/migrations/013_rental_management_analytics.sql", import.meta.url), "utf8");
const paymentMigration = readFileSync(new URL("../supabase/migrations/014_pdf_reports_and_free_rentals.sql", import.meta.url), "utf8");
const newRental = readFileSync(new URL("../src/NewRental.tsx", import.meta.url), "utf8");
const pdfReport = readFileSync(new URL("../src/reportPdf.ts", import.meta.url), "utf8");

describe("informação de gestão dos alugueres", () => {
  it("guarda o valor cobrado na operação transacional", () => {
    expect(migration).toContain("charged_amount numeric(10,2)");
    expect(migration).toContain("p_charged_amount numeric");
    expect(apiSource).toContain("p_charged_amount: chargedAmount");
    expect(newRental).toContain("Valor cobrado (€)");
    expect(newRental).toContain('min="0"');
  });
  it("distingue automaticamente alugueres gratuitos sem aumentar o formulário", () => {
    expect(paymentMigration).toContain("charged_amount_recorded boolean");
    expect(paymentMigration).toContain("free_rental_count");
    expect(paymentMigration).toContain("paid_rental_count");
    expect(newRental).not.toContain("payment-type");
  });
  it("regista períodos reais sem disponibilidade", () => {
    expect(migration).toContain("create table if not exists availability_incidents");
    expect(migration).toContain("after update of status,kiosk_id,active,asset_type on bikes");
    expect(migration).toContain("Todas alugadas");
    expect(migration).toContain("Capacidade mista");
  });
  it("calcula procura, duração e receita na base de dados", () => {
    expect(migration).toContain("create or replace function rental_management_analytics");
    expect(migration).toContain("average_duration_minutes");
    expect(migration).toContain("busiest_days");
    expect(apiSource).toContain('route === "/reports/analytics"');
    expect(pageSource).toContain("Dias com maior procura");
  });
  it("gera um PDF executivo e mantém o CSV", () => {
    expect(pdfReport).toContain("Relatório de alugueres");
    expect(pdfReport).toContain("Dias com maior procura");
    expect(pdfReport).toContain("Períodos sem bicicletas disponíveis");
    expect(pageSource).toContain("Exportar relatório (PDF)");
    expect(pageSource).toContain("Exportar dados (CSV)");
  });
});

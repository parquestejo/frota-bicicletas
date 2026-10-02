import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("correções do período de aluguer", () => {
  const migration = readFileSync(new URL("../supabase/migrations/017_rental_period_corrections.sql", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../functions/api/routes/rentals.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/pages/Rentals.tsx", import.meta.url), "utf8");

  it("permite prolongar um aluguer aberto de uma hora para um dia", () => {
    expect(migration).toContain("extend_open_rental_to_day");
    expect(migration).toContain("for update");
    expect(migration).toContain("additional_amount");
    expect(routes).toContain('parts[2] === "extend-day"');
    expect(page).toContain("Prolongar para 1 dia");
  });

  it("reserva a correção retroativa do período ao administrador", () => {
    expect(migration).toContain("admin_correct_rental_period");
    expect(routes).toContain('parts[2] === "correct-period"');
    expect(routes).toContain('allow(ctx, "admin")');
    expect(page).toContain("O valor cobrado não foi alterado");
  });

  it("preserva o valor comercial dos alugueres anteriores à versão 2.0", () => {
    expect(migration).toContain("set expected_amount=charged_amount");
    expect(migration).toContain("where expected_amount=0");
    expect(migration).toContain("commercial_value");
  });
});

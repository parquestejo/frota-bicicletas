import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/016_pricing_and_institutional_use.sql", import.meta.url), "utf8");
const api = readFileSync(new URL("../functions/api/routes/rentals.ts", import.meta.url), "utf8");
const form = readFileSync(new URL("../src/NewRental.tsx", import.meta.url), "utf8");

describe("preços e utilizações institucionais", () => {
  it("calcula preços no servidor e preserva o valor comercial", () => {
    expect(migration).toContain("expected_amount");
    expect(migration).toContain("when 'electric' then case when p_rental_period='hour' then 4 else 10 end");
    expect(migration).toContain("p_rental_kind='institutional' then commercial:=0");
  });
  it("valida o benefício de residente e a utilização institucional", () => {
    expect(api).toContain("Confirme as condições do benefício de residente");
    expect(migration).toContain("invalid_institutional_use");
    expect(form).toContain("Subscrição 120 minutos");
  });
  it("permite devoluções parciais noutro quiosque e controla cauções retidas", () => {
    expect(migration).toContain("institutional_deposit_not_allowed");
    expect(migration).toContain("deposit_retention_reason");
    expect(migration).toContain("select count(*) into remaining");
    expect(migration).toContain("expected_amount=retained");
  });
});

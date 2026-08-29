import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/010_rental_concurrency.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("contrato SQL de concorrência", () => {
  it("bloqueia os artigos reais numa ordem determinística", () => {
    expect(migration).toContain("order by id\n  for update");
    expect(migration).not.toContain("pg_advisory_xact_lock");
  });
  it("serializa devoluções através da linha do aluguer", () => {
    expect(migration).toContain("where id=p_rental_id\n  for update");
    expect(migration).toContain("if r.status<>'Em aberto'");
  });
  it("ordena também os artigos recebidos na devolução", () =>
    expect(migration).toContain("order by value->>'rental_item_id'"));
  it("impede iniciar alugueres com artigos de outro quiosque", () => {
    expect(migration).toContain("or kiosk_id<>p_start_kiosk_id");
    expect(migration).toContain("allows_rentals=true");
  });
});

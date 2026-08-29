import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { apiSource as api } from "./project-source";

const migration = readFileSync(
  new URL("../supabase/migrations/011_inventory_fault_integrity.sql", import.meta.url),
  "utf8",
);

describe("melhorias de integridade", () => {
  it("não envia chaves sb_secret como Bearer para o Storage", () => {
    expect(api).toContain('if (key.startsWith("eyJ")) headers.set("Authorization"');
  });
  it("conta avarias sem reutilizar a lista visual limitada", () => {
    expect(api).toContain("dbCount(ctx");
    expect(api).toContain("pending_faults:pendingFaultCount");
  });
  it("atualiza inventário e avarias através de funções transacionais", () => {
    expect(api).toContain('"rpc/update_inventory_item"');
    expect(migration).toContain("create or replace function update_inventory_item");
    expect(migration).toContain("create or replace function update_fault");
    expect(migration).toContain("other_open_faults");
  });
  it("calcula os totais históricos diretamente na base de dados", () => {
    expect(migration).toContain("create or replace function rental_period_summary");
    expect(api).toContain('"rpc/rental_period_summary"');
  });
});

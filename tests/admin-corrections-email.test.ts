import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/015_admin_corrections_and_email_reports.sql", import.meta.url), "utf8");
const api = readFileSync(new URL("../functions/api/[[path]].ts", import.meta.url), "utf8") + readFileSync(new URL("../functions/api/routes/rentals.ts", import.meta.url), "utf8") + readFileSync(new URL("../functions/api/routes/daily-activity.ts", import.meta.url), "utf8");
const email = readFileSync(new URL("../functions/api/email.ts", import.meta.url), "utf8");
const inventory = readFileSync(new URL("../functions/api/routes/inventory.ts", import.meta.url), "utf8");
const closures = readFileSync(new URL("../functions/api/routes/daily-activity.ts", import.meta.url), "utf8");

describe("correções administrativas e emails", () => {
  it("mantém correções auditáveis e exclui alugueres anulados dos indicadores", () => {
    expect(migration).toContain("admin_correct_rental");
    expect(migration).toContain("daily_closure_revisions");
    expect(migration).toContain("r.status<>'Anulado'");
    expect(api).toContain('parts[2] === "correct"');
  });
  it("protege o agendamento e usa uma fila idempotente", () => {
    expect(api).toContain('route === "/jobs/email"');
    expect(api).toContain("JOB_SECRET");
    expect(email).toContain('"Idempotency-Key"');
    expect(migration).toContain("dedupe_key text not null unique");
  });
  it("identifica sem ambiguidade o vigilante dos fechos", () => {
    for (const source of [inventory, closures, email]) {
      expect(source).not.toMatch(/daily_closures\?[^`\n]*user:users\(/);
    }
    expect(inventory).toContain("users!daily_closures_user_id_fkey");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { apiSource } from "./project-source";

const migration = readFileSync(new URL("../supabase/migrations/012_fault_notifications.sql", import.meta.url), "utf8");
const interfaceSource = readFileSync(new URL("../src/Notifications.tsx", import.meta.url), "utf8");

describe("alertas de avarias", () => {
  it("notifica administradores e manutenção através de trigger", () => {
    expect(migration).toContain("after insert on faults");
    expect(migration).toContain("u.role in ('admin','manutencao')");
    expect(migration).toContain("unique(user_id,fault_id)");
  });
  it("utiliza uma fila bloqueada e limita tentativas de email", () => {
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("q.attempts<5");
    expect(apiSource).toContain('"Idempotency-Key": `fault-alert-${alert.fault_id}`');
  });
  it("permite consultar e marcar notificações como lidas", () => {
    expect(apiSource).toContain('route === "/notifications"');
    expect(apiSource).toContain('route === "/notifications/read-all"');
    expect(interfaceSource).toContain("aria-label=\"Notificações de avarias\"");
    expect(interfaceSource).toContain("Marcar todas como lidas");
  });
});

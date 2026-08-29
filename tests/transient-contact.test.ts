import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/009_transient_contacts_and_accessories.sql",
    import.meta.url,
  ),
  "utf8",
);
const api = readFileSync(
  new URL("../functions/api/[[path]].ts", import.meta.url),
  "utf8",
);
const pages = readFileSync(
  new URL("../src/pages.tsx", import.meta.url),
  "utf8",
);

describe("contacto temporário do cliente", () => {
  it("é opcional e aceite no início do aluguer", () => {
    expect(migration).toContain("p_customer_contact text default null");
    expect(api).toContain("p_customer_contact: customerContact || null");
    expect(api).toContain("Indique um número de contacto válido.");
    expect(pages).toContain("Número de contacto (opcional)");
  });
  it("é apagado quando o aluguer termina", () => {
    expect(migration).toContain("new.customer_contact := null");
    expect(migration).toContain("new.status = 'Concluído'");
  });
  it("não é copiado para a auditoria", () =>
    expect(migration).toContain("to_jsonb(r)-'customer_contact'"));
});

describe("inventário automático de acessórios", () => {
  it("completa cada quiosque até oito capacetes", () => {
    expect(migration).toContain("if current_count < 8");
    expect(migration).toContain("'Capacete','helmet'");
  });
  it("completa cada quiosque até dois cadeados", () => {
    expect(migration).toContain("if current_count < 2");
    expect(migration).toContain("'Cadeado','lock'");
  });
  it("ignora armazém, evento e outras localizações internas", () =>
    expect(migration).toContain("allows_rentals=true"));
});

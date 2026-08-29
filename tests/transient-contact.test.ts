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
const newRental = readFileSync(
  new URL("../src/NewRental.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

describe("contacto temporário do cliente", () => {
  it("é opcional e aceite no início do aluguer", () => {
    expect(migration).toContain("p_customer_contact text default null");
    expect(api).toContain("p_customer_contact: customerContact || null");
    expect(api).toContain("Indique um número de contacto válido.");
    expect(newRental).toContain("Número de contacto (opcional)");
  });
  it("é apagado quando o aluguer termina", () => {
    expect(migration).toContain("new.customer_contact := null");
    expect(migration).toContain("new.status = 'Concluído'");
  });
  it("não é copiado para a auditoria", () =>
    expect(migration).toContain("to_jsonb(r)-'customer_contact'"));
  it("mantém o campo simples e sem texto explicativo", () => {
    expect(newRental).not.toContain(
      "Utilizado apenas enquanto o aluguer estiver aberto",
    );
    expect(newRental).not.toContain(
      "O contacto é eliminado automaticamente após a devolução completa.",
    );
  });
  it("abre o novo aluguer numa página própria", () => {
    expect(app).toContain('path="/alugueres/novo"');
    expect(pages).toContain('to="/alugueres/novo"');
    expect(newRental).toContain("export function NewRental");
    expect(newRental).toContain('role="alert"');
    expect(newRental).not.toContain("alert(");
  });
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

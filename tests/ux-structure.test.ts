import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { apiSource, pageSource } from "./project-source";

const appSource = [
  pageSource,
  readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../src/DailyClosures.tsx", import.meta.url), "utf8"),
].join("\n");

describe("estrutura e mensagens da interface", () => {
  it("não utiliza diálogos nativos bloqueantes", () => {
    expect(appSource).not.toMatch(/\b(alert|prompt|confirm)\s*\(/);
  });
  it("apresenta mensagens acessíveis dentro da aplicação", () => {
    expect(readFileSync(new URL("../src/Feedback.tsx", import.meta.url), "utf8")).toContain('aria-live="polite"');
  });
  it("mantém a entrada da API como orquestrador modular", () => {
    const entry = readFileSync(new URL("../functions/api/[[path]].ts", import.meta.url), "utf8");
    expect(entry.split("\n").length).toBeLessThan(300);
    expect(apiSource).toContain("handleInventoryRoutes");
    expect(apiSource).toContain("handleRentalRoutes");
  });
  it("coloca as ações operacionais antes dos indicadores no dashboard dos funcionários", () => {
    const dashboard = readFileSync(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");
    expect(dashboard).toContain("Ações rápidas");
    expect(dashboard).toContain("Registar devolução");
    expect(dashboard).toContain("Fecho diário");
    expect(dashboard.indexOf('className="employee-action-panel"')).toBeLessThan(
      dashboard.indexOf('className="metrics"'),
    );
  });
});

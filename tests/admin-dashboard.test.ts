import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { apiSource as api } from "./project-source";
const view = readFileSync(
  new URL("../src/AdminDashboard.tsx", import.meta.url),
  "utf8",
);

describe("dashboard administrativo", () => {
  it("calcula períodos apenas para administradores", () =>
    expect(api).toContain("if(ctx.user.role==='admin')"));
  it("inclui receita, alugueres abertos, avarias e discrepâncias", () => {
    expect(api).toContain("previous_revenue");
    expect(api).toContain("pending_discrepancies");
    expect(api).toContain("open_rentals:openRentalDetails");
  });
  it("apresenta relatórios e acesso aos talões", () => {
    expect(view).toContain("Últimos relatórios de final de dia");
    expect(view).toContain("/receipt");
  });
  it("mostra os três últimos fechos de cada quiosque", () => {
    expect(api).toContain("recentClosureGroups");
    expect(api).toContain("&limit=3");
    expect(api).toContain("String(b.report_date||'').localeCompare");
    expect(view).toContain("3 por quiosque");
  });
  it("limita o inventário aos itens disponíveis e alugados", () => {
    expect(api).toContain(
      "b.kiosk_id===k.id&&['Disponível','Alugada'].includes(b.status)",
    );
    expect(view).not.toContain("Avar./Manut.");
  });
  it("permite exportar a informação de gestão", () =>
    expect(view).toContain("dashboard-gestao.csv"));
  it("não cria um contador de fechos em falta", () =>
    expect(view).not.toContain("Fechos em falta"));
});

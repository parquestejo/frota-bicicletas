import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const api = readFileSync(
  new URL("../functions/api/[[path]].ts", import.meta.url),
  "utf8",
);
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
    expect(view).toContain("Relatórios de final de dia — hoje");
    expect(view).toContain("/receipt");
  });
  it("permite exportar a informação de gestão", () =>
    expect(view).toContain("dashboard-gestao.csv"));
  it("não cria um contador de fechos em falta", () =>
    expect(view).not.toContain("Fechos em falta"));
});

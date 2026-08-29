import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/008_children_and_accessories.sql",
    import.meta.url,
  ),
  "utf8",
);
const api = readFileSync(
  new URL("../functions/api/[[path]].ts", import.meta.url),
  "utf8",
);

describe("bicicletas infantis e acessórios", () => {
  it("cria as seis categorias de inventário", () =>
    expect(migration).toContain(
      "'electric','conventional','child','helmet','lock','stroller'",
    ));
  it("aceita os prefixos dos novos códigos", () => {
    expect(migration).toContain("^(E|C|I)");
    expect(migration).toContain("^(CAP|CAD|CAR)");
  });
  it("contabiliza bicicletas infantis e acessórios no fecho", () => {
    expect(migration).toContain("'child_count'");
    expect(migration).toContain("'accessory_count'");
  });
});

describe("visibilidade operacional do funcionário", () => {
  it("filtra a frota pelos quiosques que permitem alugueres", () =>
    expect(api).toContain(
      "ctx.user.role==='funcionario'?'&allows_rentals=eq.true':''",
    ));
  it("não devolve notas ou fotografias na consulta operacional", () =>
    expect(api).toContain(
      "select=id,code,asset_type,model,kiosk_id,status,active,created_at,updated_at",
    ));
});

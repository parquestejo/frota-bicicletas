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
const pages = readFileSync(
  new URL("../src/pages.tsx", import.meta.url),
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

describe("matriz de inventário", () => {
  it("cruza localização, tipologia e estado", () => {
    expect(pages).toContain("Por localização, tipologia e estado");
    expect(pages).toContain("byLocationAndType");
    expect(pages).toContain("Elétricas");
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
  it("mantém o dashboard do funcionário limitado aos estados operacionais", () => {
    expect(api).toContain(
      "['Disponível','Alugada'].includes(b.status)",
    );
  });
  it("devolve todos os estados dos itens localizados nos quiosques", () => {
    expect(api).toContain(
      "bikes?active=eq.true&kiosk_id=in.(${kioskIds.join(',')})&select=id,code,asset_type,model,kiosk_id,status",
    );
    expect(api).not.toContain(
      "kiosk_id=in.(${kioskIds.join(',')})&status=in.",
    );
    expect(pages).toContain("const visibleStatuses = statuses");
  });
});

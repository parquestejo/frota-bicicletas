import { describe, expect, it } from "vitest";
import { normalizeApiPath } from "../src/shared/route";

describe("rotas catch-all do Cloudflare Pages", () => {
  it("normaliza uma rota com um segmento", () =>
    expect(normalizeApiPath("bootstrap")).toBe("/bootstrap"));
  it("normaliza uma rota multiparte recebida como lista", () =>
    expect(normalizeApiPath(["auth", "login"])).toBe("/auth/login"));
  it("normaliza uma rota multiparte recebida como texto", () =>
    expect(normalizeApiPath("rentals/123/return")).toBe("/rentals/123/return"));
  it("normaliza a rota do talão de fecho diário", () =>
    expect(normalizeApiPath(["daily-closures", "abc", "receipt"])).toBe(
      "/daily-closures/abc/receipt",
    ));
  it("normaliza a rota para adicionar uma bicicleta", () =>
    expect(normalizeApiPath(["rentals", "abc", "add-bike"])).toBe(
      "/rentals/abc/add-bike",
    ));
  it("normaliza a rota para resolver uma discrepância", () =>
    expect(normalizeApiPath(["rental-discrepancies", "abc", "resolve"])).toBe(
      "/rental-discrepancies/abc/resolve",
    ));
});

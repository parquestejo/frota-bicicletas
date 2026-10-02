import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const faults = readFileSync(new URL("../src/pages/Faults.tsx", import.meta.url), "utf8");
const fleet = readFileSync(new URL("../src/pages/Fleet.tsx", import.meta.url), "utf8");

describe("filtros de manutenção e disponibilidade", () => {
  it("usa as ocorrências filtradas no resumo e na tabela", () => {
    expect(faults).toContain("<MaintenanceSummary faults={visibleFaults} />");
    expect(faults).toContain("visibleFaults.map");
  });

  it("calcula a disponibilidade apenas com bicicletas", () => {
    expect(fleet).toContain("activeBicycles = active.filter(isBicycle)");
    expect(fleet).toContain("available / activeBicycles.length");
    expect(fleet).toContain("bicicletas disponíveis");
  });
});

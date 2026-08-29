import { describe, expect, it } from "vitest";
import { apiSource as source } from "./project-source";

describe("permissões de avarias", () => {
  it("disponibiliza uma rota limitada para comunicar avarias", () =>
    expect(source).toContain('route === "/faults/report-options"'));
  it("reserva a consulta a administradores e manutenção", () =>
    expect(source).toContain(
      'if (route === "/faults" && request.method === "GET")',
    ));
  it("reserva a atualização a administradores e manutenção", () =>
    expect(source).toContain(
      'parts[0] === "faults" && parts[1] && request.method === "PATCH"',
    ));
});

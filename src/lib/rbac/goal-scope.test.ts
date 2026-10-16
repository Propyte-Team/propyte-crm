import { describe, it, expect } from "vitest";
import { nivelMetas, metasVisiblesWhere, filtroScorecard, puedeFijarMetasEmpresa } from "./goal-scope";

describe("goal-scope (#895)", () => {
  it("niveles por rol", () => {
    expect(nivelMetas({ id: "a", role: "ADMIN" })).toBe("TODO");
    expect(nivelMetas({ id: "d", role: "DIRECTOR" })).toBe("TODO");
    expect(nivelMetas({ id: "g", role: "GERENTE", plaza: "CANCUN" })).toBe("PLAZA");
    expect(nivelMetas({ id: "t", role: "TEAM_LEADER" })).toBe("EQUIPO");
    expect(nivelMetas({ id: "m", role: "MARKETING" })).toBe("PROPIO");
    expect(nivelMetas({ id: "h", role: "HOSTESS" })).toBe("PROPIO");
  });

  it("un gerente sin plaza no amplía a ciegas: se queda en lo propio", () => {
    expect(nivelMetas({ id: "g", role: "GERENTE", plaza: null })).toBe("PROPIO");
  });

  it("un rol desconocido cae en lo propio, nunca en todo", () => {
    expect(nivelMetas({ id: "x", role: "ROL_NUEVO" })).toBe("PROPIO");
    expect(metasVisiblesWhere({ id: "x", role: "ROL_NUEVO" })).toBeDefined();
  });

  it("solo ADMIN y DIRECTOR fijan metas de la empresa", () => {
    expect(["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER", "MARKETING", "ASESOR"].filter(puedeFijarMetasEmpresa))
      .toEqual(["ADMIN", "DIRECTOR"]);
  });

  it("scorecard sin filtros = mis metas + empresa; scope inválido = error", () => {
    expect(filtroScorecard({ id: "u1", role: "ASESOR" }, {})).toEqual({
      where: { OR: [{ scope: "COMPANY" }, { scope: "USER", userId: "u1" }] },
    });
    expect(filtroScorecard({ id: "u1", role: "ASESOR" }, { scope: "X" })).toHaveProperty("error");
  });
});

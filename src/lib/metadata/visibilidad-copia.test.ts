import { describe, it, expect } from "vitest";
import { planCopiaPermisos } from "./visibilidad-model";

describe("planCopiaPermisos", () => {
  const perms = [
    { fieldKey: "a", role: "GERENTE", access: "HIDDEN" as const },
    { fieldKey: "b", role: "GERENTE", access: "READ" as const },
    { fieldKey: "b", role: "ASESOR", access: "READ" as const },
    { fieldKey: "c", role: "ASESOR", access: "HIDDEN" as const },
  ];
  it("agrupa solo lo que difiere", () => {
    const p = planCopiaPermisos(perms, "GERENTE", "ASESOR", ["a", "b", "c"]);
    expect(p.porAcceso).toEqual({ HIDDEN: ["a"], READ: [], EDIT: ["c"] });
    expect(p.total).toBe(2);
    expect(p.seOcultan).toEqual(["a"]);
  });
  it("mismo rol no cambia nada", () => {
    expect(planCopiaPermisos(perms, "ASESOR", "ASESOR", ["a"]).total).toBe(0);
  });
});

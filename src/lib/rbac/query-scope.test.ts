import { describe, it, expect } from "vitest";
import { resolveScopeBucket, canReadUserScope, type RoleSets, andWhere } from "./query-scope";

// Sets reales de /api/commissions y /api/activities (ADMIN aparece en full Y en team).
const SETS: RoleSets = {
  full: ["ADMIN", "DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"],
  team: ["ADMIN", "TEAM_LEADER"],
  own: ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "HOSTESS"],
};

describe("resolveScopeBucket", () => {
  it("ADMIN ve TODO aunque también esté en el set TEAM", () => {
    expect(resolveScopeBucket("ADMIN", SETS)).toBe("ALL");
  });

  it.each(["DIRECTOR", "GERENTE", "DEVELOPER_EXT", "MANTENIMIENTO"])("%s ve todo", (r) => {
    expect(resolveScopeBucket(r, SETS)).toBe("ALL");
  });

  it("TEAM_LEADER ve a su equipo", () => {
    expect(resolveScopeBucket("TEAM_LEADER", SETS)).toBe("TEAM");
  });

  it.each(["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "HOSTESS"])("%s ve solo lo propio", (r) => {
    expect(resolveScopeBucket(r, SETS)).toBe("OWN");
  });

  it("un rol fuera de todo set queda DENIED, no cae a un default permisivo", () => {
    expect(resolveScopeBucket("MARKETING", SETS)).toBe("DENIED");
  });

  it("alsoAll permite el caso MARKETING de actividades sin tocar los otros sets", () => {
    expect(resolveScopeBucket("MARKETING", { ...SETS, alsoAll: ["MARKETING"] })).toBe("ALL");
    // y no contamina a los demás
    expect(resolveScopeBucket("ASESOR", { ...SETS, alsoAll: ["MARKETING"] })).toBe("OWN");
  });
});

describe("canReadUserScope — el ?userId= no puede ampliar el alcance", () => {
  it("un ASESOR NO puede leer los datos de otro usuario", () => {
    expect(canReadUserScope("OWN", ["yo"], "alguien-mas")).toBe(false);
  });

  it("un ASESOR sí puede pedir explícitamente los suyos", () => {
    expect(canReadUserScope("OWN", ["yo"], "yo")).toBe(true);
  });

  it("un TEAM_LEADER puede leer a alguien de su equipo pero no de fuera", () => {
    expect(canReadUserScope("TEAM", ["lider", "miembro"], "miembro")).toBe(true);
    expect(canReadUserScope("TEAM", ["lider", "miembro"], "ajeno")).toBe(false);
  });

  it("ALL puede leer a cualquiera", () => {
    expect(canReadUserScope("ALL", [], "cualquiera")).toBe(true);
  });

  it("DENIED no puede leer a nadie, ni a sí mismo", () => {
    expect(canReadUserScope("DENIED", ["yo"], "yo")).toBe(false);
  });
});

describe("andWhere (#881)", () => {
  it("suma la condición al AND sin tocar las claves del alcance", () => {
    const where: { assignedToId?: unknown; AND?: unknown } = { assignedToId: "yo" };
    andWhere(where as never, { assignedToId: "otro" } as never);
    expect(where).toEqual({ assignedToId: "yo", AND: [{ assignedToId: "otro" }] });
  });

  it("conserva un AND previo, sea objeto o arreglo", () => {
    const conObjeto = { AND: { a: 1 } };
    andWhere(conObjeto as never, { b: 2 } as never);
    expect(conObjeto.AND).toEqual([{ a: 1 }, { b: 2 }]);
    const conArreglo = { AND: [{ a: 1 }] };
    andWhere(conArreglo as never, { b: 2 } as never);
    expect(conArreglo.AND).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("no muta un AND compartido con otro where", () => {
    const compartido = [{ marca: "x" }];
    const base = { AND: compartido };
    const copia = { ...base };
    andWhere(copia as never, { assignedToId: "a" } as never);
    expect(base.AND).toEqual([{ marca: "x" }]);
    expect(copia.AND).toEqual([{ marca: "x" }, { assignedToId: "a" }]);
  });
});

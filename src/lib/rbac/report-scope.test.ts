import { describe, it, expect } from "vitest";
import {
  REPORTES_ROLES,
  alcanceActividadesReporte,
  alcanceComisionesReporte,
  alcanceContactosReporte,
  alcanceNegociosReporte,
  nivelComisiones,
  nivelReportes,
  puedeVerReportes,
} from "./report-scope";
import { navGroups } from "@/components/layout/nav-config";

// #893: /reports y sus consultas solo pedían sesión. La puerta son los roles del menú y el
// alcance es la matriz de la #869: ADMIN, DIRECTOR y MARKETING todo · GERENTE su plaza ·
// TEAM_LEADER su equipo · cualquier otro rol solo lo suyo. Comisiones sigue al módulo Comisiones.

const TODOS_LOS_ROLES = [
  "ADMIN",
  "DIRECTOR",
  "GERENTE",
  "TEAM_LEADER",
  "ASESOR",
  "ASESOR_SR",
  "ASESOR_JR",
  "HOSTESS",
  "MARKETING",
  "DEVELOPER_EXT",
  "BROKER",
  "MANTENIMIENTO",
];

describe("puedeVerReportes — la puerta de /reports", () => {
  it.each(["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER", "MARKETING", "MANTENIMIENTO"])("%s entra", (role) => {
    expect(puedeVerReportes(role)).toBe(true);
  });

  it.each(["ASESOR", "ASESOR_SR", "ASESOR_JR", "HOSTESS", "BROKER", "DEVELOPER_EXT", "ROL_NUEVO", "", null, undefined])(
    "%s no entra",
    (role) => {
      expect(puedeVerReportes(role as string | null | undefined)).toBe(false);
    },
  );

  it("el menú muestra Reportes exactamente a los roles que pasan la puerta (más ADMIN, que ve todo)", () => {
    const item = navGroups.flatMap((g) => g.items).find((i) => i.href === "/reports");
    expect(item?.roles).toEqual([...REPORTES_ROLES]);
    for (const role of TODOS_LOS_ROLES) {
      const enMenu = role === "ADMIN" || item!.roles.includes(role);
      expect(puedeVerReportes(role), role).toBe(enMenu);
    }
  });
});

describe("nivelReportes — matriz #869", () => {
  it.each([
    ["ADMIN", "TODO"],
    ["DIRECTOR", "TODO"],
    ["MARKETING", "TODO"],
    ["GERENTE", "PLAZA"],
    ["TEAM_LEADER", "EQUIPO"],
    ["ASESOR_SR", "PROPIO"],
    ["MANTENIMIENTO", "PROPIO"],
    ["ROL_NUEVO", "PROPIO"],
  ])("%s → %s", (role, nivel) => {
    expect(nivelReportes({ id: "u1", role, plaza: "PDC" })).toBe(nivel);
  });

  it("un GERENTE sin plaza no se amplía a ciegas: se queda en lo propio", () => {
    expect(nivelReportes({ id: "g1", role: "GERENTE", plaza: null })).toBe("PROPIO");
  });
});

describe("nivelComisiones — los conjuntos del módulo Comisiones", () => {
  it.each([
    ["ADMIN", "TODO"],
    ["DIRECTOR", "TODO"],
    ["GERENTE", "PLAZA"],
    ["TEAM_LEADER", "EQUIPO"],
    ["ASESOR", "PROPIO"],
    ["BROKER", "PROPIO"],
    // No tienen Comisiones en el menú: en el reporte ven solo las suyas, igual que en /commissions.
    ["MARKETING", "PROPIO"],
    ["MANTENIMIENTO", "PROPIO"],
  ])("%s → %s", (role, nivel) => {
    expect(nivelComisiones({ id: "u1", role, plaza: "PDC" })).toBe(nivel);
  });
});

describe("filtros de Prisma por nivel", () => {
  it.each(["ADMIN", "DIRECTOR", "MARKETING"])("%s: sin restricción por rol", (role) => {
    const u = { id: "d1", role, plaza: "PDC" };
    expect(alcanceNegociosReporte(u)).toBeUndefined();
    expect(alcanceContactosReporte(u)).toBeUndefined();
    expect(alcanceActividadesReporte(u)).toBeUndefined();
  });

  it("GERENTE: lo suyo + lo de los asesores de su plaza, no de otra", () => {
    const u = { id: "g1", role: "GERENTE", plaza: "MERIDA" };
    expect(alcanceNegociosReporte(u)).toEqual({
      OR: [{ assignedToId: "g1" }, { assignedTo: { plaza: "MERIDA" } }],
    });
    expect(alcanceContactosReporte(u)).toEqual({
      OR: [{ assignedToId: "g1" }, { assignedTo: { is: { plaza: "MERIDA" } } }],
    });
    expect(alcanceActividadesReporte(u)).toEqual({
      OR: [{ userId: "g1" }, { user: { plaza: "MERIDA" } }],
    });
  });

  it("TEAM_LEADER: lo suyo + su equipo, no la plaza entera", () => {
    const u = { id: "tl1", role: "TEAM_LEADER", plaza: "PDC" };
    expect(alcanceNegociosReporte(u)).toEqual({
      OR: [{ assignedToId: "tl1" }, { assignedTo: { teamLeaderId: "tl1" } }],
    });
    expect(alcanceContactosReporte(u)).toEqual({
      OR: [{ assignedToId: "tl1" }, { assignedTo: { is: { teamLeaderId: "tl1" } } }],
    });
    expect(alcanceActividadesReporte(u)).toEqual({
      OR: [{ userId: "tl1" }, { user: { teamLeaderId: "tl1" } }],
    });
  });

  it("cualquier otro rol: solo lo suyo", () => {
    const u = { id: "m1", role: "MANTENIMIENTO", plaza: "PDC" };
    expect(alcanceNegociosReporte(u)).toEqual({ assignedToId: "m1" });
    expect(alcanceContactosReporte(u)).toEqual({ assignedToId: "m1" });
    expect(alcanceActividadesReporte(u)).toEqual({ userId: "m1" });
  });

  it("comisiones: MARKETING ve todo en los demás reportes, pero en comisiones solo las suyas", () => {
    const u = { id: "mk1", role: "MARKETING", plaza: "PDC" };
    expect(alcanceNegociosReporte(u)).toBeUndefined();
    expect(alcanceComisionesReporte(u)).toEqual({ assignedToId: "mk1" });
  });

  it("comisiones: DIRECTOR todas, GERENTE su plaza", () => {
    expect(alcanceComisionesReporte({ id: "d1", role: "DIRECTOR", plaza: "PDC" })).toBeUndefined();
    expect(alcanceComisionesReporte({ id: "g1", role: "GERENTE", plaza: "TULUM" })).toEqual({
      OR: [{ assignedToId: "g1" }, { assignedTo: { plaza: "TULUM" } }],
    });
  });
});

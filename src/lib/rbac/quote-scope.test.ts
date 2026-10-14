import { describe, it, expect } from "vitest";
import { alcanceCotizaciones, puedeModificarCotizaciones } from "./quote-scope";
import type { VisibleBrands } from "@/lib/brands/visibility";

// #867: la lista de /cotizaciones no filtraba por usuario. Matriz pedida el 2026-10-14:
// ADMIN todas · DIRECTOR y MARKETING todas, solo lectura · GERENTE su plaza ·
// TEAM_LEADER su equipo (no la plaza entera) · cualquier otro rol solo las suyas.

const propias = (id: string) => [{ createdById: id }, { deal: { assignedToId: id } }];
const SOLO_B1: VisibleBrands = { brandIds: ["b1"], includesDefault: false };
const marcaB1 = (id: string) => ({
  deal: {
    OR: [
      { assignedToId: id },
      { contact: { OR: [{ assignedToId: id }, { brands: { some: { brandId: { in: ["b1"] } } } }] } },
    ],
  },
});

describe("alcanceCotizaciones — qué lista ve cada rol", () => {
  it("ADMIN ve todas, sin filtro de marca", () => {
    expect(alcanceCotizaciones({ id: "a1", role: "ADMIN", plaza: "PDC" }, SOLO_B1)).toEqual({});
  });

  it.each(["DIRECTOR", "MARKETING"])("%s ve todas", (role) => {
    expect(alcanceCotizaciones({ id: "d1", role, plaza: "PDC" }, "ALL")).toEqual({
      OR: [...propias("d1"), {}],
    });
  });

  it("DIRECTOR ve todas, pero dentro de sus marcas", () => {
    expect(alcanceCotizaciones({ id: "d1", role: "DIRECTOR", plaza: "PDC" }, SOLO_B1)).toEqual({
      OR: [...propias("d1"), { AND: [{}, marcaB1("d1")] }],
    });
  });

  it("GERENTE ve las de negocios de su plaza, no las de otra", () => {
    expect(alcanceCotizaciones({ id: "g1", role: "GERENTE", plaza: "MERIDA" }, "ALL")).toEqual({
      OR: [...propias("g1"), { deal: { assignedTo: { plaza: "MERIDA" } } }],
    });
  });

  it("TEAM_LEADER ve las de su equipo — NO la plaza entera (varios equipos por plaza)", () => {
    const w = alcanceCotizaciones({ id: "tl1", role: "TEAM_LEADER", plaza: "PDC" }, "ALL");
    expect(w).toEqual({ OR: [...propias("tl1"), { deal: { assignedTo: { teamLeaderId: "tl1" } } }] });
    expect(JSON.stringify(w)).not.toContain("plaza");
  });

  it("TEAM_LEADER: su equipo, dentro de sus marcas", () => {
    expect(alcanceCotizaciones({ id: "tl1", role: "TEAM_LEADER", plaza: "PDC" }, SOLO_B1)).toEqual({
      OR: [...propias("tl1"), { AND: [{ deal: { assignedTo: { teamLeaderId: "tl1" } } }, marcaB1("tl1")] }],
    });
  });

  it.each(["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "HOSTESS", "DEVELOPER_EXT", "MANTENIMIENTO", "ROL_NUEVO"])(
    "%s ve solo las que emitió o las de sus negocios",
    (role) => {
      expect(alcanceCotizaciones({ id: "u1", role, plaza: "PDC" }, "ALL")).toEqual({ OR: propias("u1") });
    },
  );

  it("GERENTE sin plaza no se amplía: solo las suyas", () => {
    expect(alcanceCotizaciones({ id: "g1", role: "GERENTE", plaza: null }, "ALL")).toEqual({ OR: propias("g1") });
  });
});

describe("puedeModificarCotizaciones — quién escribe", () => {
  it.each(["ADMIN", "GERENTE", "TEAM_LEADER", "ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER"])("%s sí", (role) => {
    expect(puedeModificarCotizaciones(role)).toBe(true);
  });
  it.each(["DIRECTOR", "MARKETING", "DEVELOPER_EXT"])("%s no: solo lectura", (role) => {
    expect(puedeModificarCotizaciones(role)).toBe(false);
  });
});

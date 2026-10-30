import { describe, it, expect, vi } from "vitest";

// alcance-lista importa Prisma; aquí solo hacen falta sus listas de roles.
vi.mock("@/lib/db", () => ({ default: {} }));
import {
  buscarPorNombre,
  campoCampana,
  claveCatalogo,
  detalleFuenteHistorico,
  esTipoCampana,
  filtrarCatalogo,
  limpiarNombre,
  puedeCrearEnCatalogo,
} from "./clave";
import {
  FULL_ACCESS_ROLES,
  OWN_ACCESS_ROLES,
  PLAZA_ACCESS_ROLES,
  TEAM_ACCESS_ROLES,
} from "@/lib/contacts/alcance-lista";

describe("claveCatalogo (#936/#937)", () => {
  it("«LEAD FRIO», «Lead frío» y « lead  frio » son la misma", () => {
    expect(claveCatalogo("LEAD FRIO")).toBe("lead frio");
    expect(claveCatalogo("Lead frío")).toBe("lead frio");
    expect(claveCatalogo("  lead   frio ")).toBe("lead frio");
  });
  it("quita acentos, diéresis y la tilde de la ñ (igual que el translate de la migración)", () => {
    expect(claveCatalogo("ÁÉÍÓÚÜÑ áéíóúüñ")).toBe("aeiouun aeiouun");
  });
  it("respeta la puntuación", () => {
    expect(claveCatalogo("¡FALTA DE SEGUIMIENTO!")).toBe("¡falta de seguimiento!");
  });
  it("limpiarNombre colapsa espacios pero respeta mayúsculas y acentos", () => {
    expect(limpiarNombre("  Expo   Mérida ")).toBe("Expo Mérida");
  });
});

describe("filtrarCatalogo / buscarPorNombre", () => {
  const ops = [
    { id: "1", name: "LEAD FRIO" },
    { id: "2", name: "Expo Mérida 2026" },
    { id: "3", name: "HOT" },
  ];
  it("filtra por palabras sin acentos ni mayúsculas", () => {
    expect(filtrarCatalogo(ops, "merida").map((o) => o.id)).toEqual(["2"]);
    expect(filtrarCatalogo(ops, "expo 2026").map((o) => o.id)).toEqual(["2"]);
    expect(filtrarCatalogo(ops, "")).toHaveLength(3);
  });
  it("buscarPorNombre encuentra la misma etiqueta escrita distinto", () => {
    expect(buscarPorNombre(ops, "lead frío")?.id).toBe("1");
    expect(buscarPorNombre(ops, "lead")).toBeUndefined();
    expect(buscarPorNombre(ops, "   ")).toBeUndefined();
  });
});

describe("puedeCrearEnCatalogo (decisión 30-oct: todos los que editan contactos)", () => {
  it("es exactamente la lista que puede dar de alta un contacto en POST /api/contacts", () => {
    const alta = new Set([...FULL_ACCESS_ROLES, ...PLAZA_ACCESS_ROLES, ...TEAM_ACCESS_ROLES, ...OWN_ACCESS_ROLES, "HOSTESS"]);
    for (const r of alta) expect(puedeCrearEnCatalogo(r), r).toBe(true);
    for (const r of ["MARKETING", "ROL_INVENTADO", "", null, undefined]) expect(puedeCrearEnCatalogo(r as string)).toBe(false);
  });
});

describe("campoCampana / tipos / detalle histórico", () => {
  it("al crear solo manda si se eligió; al editar solo si cambió (null = quitar)", () => {
    expect(campoCampana("create", null, null)).toEqual({});
    expect(campoCampana("create", null, "c1")).toEqual({ campaignId: "c1" });
    expect(campoCampana("edit", "c1", "c1")).toEqual({});
    expect(campoCampana("edit", "c1", null)).toEqual({ campaignId: null });
    expect(campoCampana("edit", null, "c2")).toEqual({ campaignId: "c2" });
  });
  it("solo CAMPANA y EVENTO son tipos válidos", () => {
    expect(esTipoCampana("CAMPANA")).toBe(true);
    expect(esTipoCampana("EVENTO")).toBe(true);
    expect(esTipoCampana("OTRO")).toBe(false);
  });
  it("el detalle viejo se muestra, salvo los «comentario:<id>» técnicos", () => {
    expect(detalleFuenteHistorico("Facebook Ads")).toBe("Facebook Ads");
    expect(detalleFuenteHistorico("comentario:2106777199430207_1641445077993119")).toBeNull();
    expect(detalleFuenteHistorico("  ")).toBeNull();
    expect(detalleFuenteHistorico(null)).toBeNull();
  });
});

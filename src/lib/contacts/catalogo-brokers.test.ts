import { describe, it, expect, vi, beforeEach } from "vitest";

// #935: catálogo de «Registrado por». Todos los roles que trabajan contactos ven a TODOS los
// brokers (sin alcance por dueño); la marca sí recorta.

const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({ default: { contact: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));

const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { brokerCatalogWhere, brokerElegible, puedeVerCatalogoBrokers } from "./catalogo-brokers";

const ASESOR = { id: "ase-1", role: "ASESOR_JR" };
const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };

beforeEach(() => {
  findFirst.mockReset();
  getVisibleBrands.mockReset();
  getVisibleBrands.mockResolvedValue("ALL");
});

describe("puedeVerCatalogoBrokers", () => {
  it.each(["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER", "ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER", "MARKETING", "HOSTESS"])(
    "%s: sí",
    (rol) => expect(puedeVerCatalogoBrokers(rol)).toBe(true),
  );
  it("un rol desconocido: no", () => expect(puedeVerCatalogoBrokers("ROL_INVENTADO")).toBe(false));
});

describe("brokerCatalogWhere", () => {
  it("asesor: todos los brokers vivos, SIN filtro por dueño", async () => {
    const where = await brokerCatalogWhere(ASESOR);
    expect(where).toEqual({ deletedAt: null, contactType: "BROKER_EXTERNO" });
    expect(JSON.stringify(where)).not.toContain("assignedToId");
  });

  it("cada palabra de la búsqueda debe estar en nombre o apellido («Karen Fuentes»)", async () => {
    const where = await brokerCatalogWhere(ASESOR, { search: "  Karen   Fuentes " });
    expect(where.AND).toEqual([
      { OR: [{ firstName: { contains: "Karen", mode: "insensitive" } }, { lastName: { contains: "Karen", mode: "insensitive" } }] },
      { OR: [{ firstName: { contains: "Fuentes", mode: "insensitive" } }, { lastName: { contains: "Fuentes", mode: "insensitive" } }] },
    ]);
  });

  it("excluye el contacto que se edita", async () => {
    const where = await brokerCatalogWhere(ASESOR, { excluirId: "c-1" });
    expect(where.id).toEqual({ not: "c-1" });
  });

  it("con marcas: recorta por marca (el término de visibilidad incluye 'lo asignado a mí')", async () => {
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    const where = await brokerCatalogWhere(ASESOR);
    expect(where.AND).toEqual([
      {
        OR: [
          { assignedToId: "ase-1" },
          { brands: { some: { brandId: { in: ["b-def"] } } } },
          { brands: { none: {} } },
        ],
      },
    ]);
  });
});

describe("brokerElegible", () => {
  it("busca por id, vivo, sin alcance por dueño, y devuelve id + tipo", async () => {
    findFirst.mockResolvedValue({ id: "b-1", contactType: "BROKER_EXTERNO" });
    await expect(brokerElegible(ASESOR, "b-1")).resolves.toEqual({ id: "b-1", contactType: "BROKER_EXTERNO" });
    expect(findFirst.mock.calls[0][0]).toEqual({
      where: { id: "b-1", deletedAt: null },
      select: { id: true, contactType: true },
    });
  });

  it("con marcas: el mismo recorte de marca que el catálogo", async () => {
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    findFirst.mockResolvedValue(null);
    await expect(brokerElegible(ASESOR, "b-1")).resolves.toBeNull();
    expect(findFirst.mock.calls[0][0].where.AND).toHaveLength(1);
  });

  it("rol desconocido: null sin tocar la base", async () => {
    await expect(brokerElegible({ id: "x", role: "ROL_INVENTADO" }, "b-1")).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});

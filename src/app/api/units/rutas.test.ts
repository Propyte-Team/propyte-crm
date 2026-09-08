import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #745, verificación de extremo a extremo en el listado de unidades: que un
// parámetro mal escrito se conteste con 400 y NUNCA llegue a la base.
//
// Contra el código anterior estas pruebas fallan de dos maneras distintas: los enums y el
// sortBy/sortOrder llegaban a Prisma y salían como 500, y `?minPrice=abc` no fallaba
// —metía `gte: NaN` en el filtro— así que devolvía 200 con una lista sin sentido.

const developmentFindUnique = vi.fn();
const unitFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    development: { findUnique: (...a: unknown[]) => developmentFindUnique(...a) },
    unit: { findMany: (...a: unknown[]) => unitFindMany(...a) },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "u1", role: "ADMIN", plaza: "PDC" } }),
}));

import { GET } from "./route";

const DEV = "11111111-1111-4111-8111-111111111111";

function pedir(query: string) {
  return GET(new Request(`http://t/api/units?developmentId=${DEV}&${query}`) as never);
}

beforeEach(() => {
  developmentFindUnique.mockReset().mockResolvedValue({ id: DEV, deletedAt: null });
  unitFindMany.mockReset().mockResolvedValue([]);
});

describe("GET /api/units — parámetros inválidos son 400 (#745)", () => {
  it("un sortBy inventado", async () => {
    const res = await pedir("sortBy=noExiste");

    expect(res.status).toBe(400);
    expect(unitFindMany).not.toHaveBeenCalled();
  });

  it("un sortOrder mal escrito", async () => {
    const res = await pedir("sortOrder=ascending");

    expect(res.status).toBe(400);
    expect(unitFindMany).not.toHaveBeenCalled();
  });

  it("un estado fuera del enum", async () => {
    const res = await pedir("status=VENDIDO");

    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(unitFindMany).not.toHaveBeenCalled();
  });

  it("un tipo de unidad fuera del enum", async () => {
    expect((await pedir("unitType=LOFT")).status).toBe(400);
    expect(unitFindMany).not.toHaveBeenCalled();
  });

  it("un precio que no es número: antes esto era un 200 con `gte: NaN`", async () => {
    const res = await pedir("minPrice=abc");

    expect(res.status).toBe(400);
    expect(unitFindMany).not.toHaveBeenCalled();
  });

  it("se valida ANTES de ir por el desarrollo, no después", async () => {
    // Un parámetro mal escrito no debe costar ni una consulta.
    await pedir("sortBy=noExiste");

    expect(developmentFindUnique).not.toHaveBeenCalled();
  });
});

describe("GET /api/units — lo válido sigue funcionando igual (#745)", () => {
  it("sin parámetros de orden, ordena por número de unidad ascendente", async () => {
    const res = await pedir("");

    expect(res.status).toBe(200);
    expect(unitFindMany.mock.calls[0][0].orderBy).toEqual({ unitNumber: "asc" });
  });

  it("los filtros válidos viajan con el tipo correcto", async () => {
    const res = await pedir("status=APARTADA&unitType=CASA&minPrice=100&maxPrice=200.5&sortBy=price&sortOrder=desc");

    expect(res.status).toBe(200);
    const args = unitFindMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ price: "desc" });
    expect(args.where.status).toBe("APARTADA");
    expect(args.where.unitType).toBe("CASA");
    expect(args.where.price).toEqual({ gte: 100, lte: 200.5 });
  });

  it("minPrice=0 sí filtra: es un número válido, no un valor ausente", async () => {
    // Con el `if (minPrice)` anterior sobre el string "0" esto también entraba, pero con
    // el número ya convertido un `if (precioMin.valor)` lo habría descartado. De ahí que
    // la ruta compare contra undefined y no contra la verdad del valor.
    await pedir("minPrice=0");

    expect(unitFindMany.mock.calls[0][0].where.price).toEqual({ gte: 0 });
  });
});

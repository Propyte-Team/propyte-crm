// #938 — filtro «Tipo» de la lista de Contactos con los tipos nuevos.
//
// Medido sobre FILAS con el mismo evaluador de `where` que usan #881, #919 y #951. «Lead Comprador»
// también trae a los contactos que siguen con un tipo retirado (Lead, Comprador, Inversionista):
// los datos se migran después del despliegue, y un enlace guardado con ?type=COMPRADOR sigue
// sirviendo.
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.fn();
const contactCount = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      count: (...a: unknown[]) => contactCount(...a),
    },
    user: { findMany: vi.fn(async () => []) },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));
vi.mock("@/lib/api/orden", () => ({ ordenValidado: () => ({ orderBy: undefined, error: null }) }));
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: () => Promise.resolve("ALL") }));

import { GET } from "./route";
import { cumple, type Fila } from "@/lib/testing/cumple-where";

const FILAS: Fila[] = [
  { id: "lead-comprador", deletedAt: null, assignedToId: "ase-1", contactType: "LEAD_COMPRADOR" },
  { id: "comprador-viejo", deletedAt: null, assignedToId: "ase-1", contactType: "COMPRADOR" },
  { id: "lead-viejo", deletedAt: null, assignedToId: "ase-1", contactType: "LEAD" },
  { id: "inversionista-viejo", deletedAt: null, assignedToId: "ase-1", contactType: "INVERSIONISTA" },
  { id: "vendedor", deletedAt: null, assignedToId: "ase-1", contactType: "LEAD_VENDEDOR" },
  { id: "ref-broker", deletedAt: null, assignedToId: "ase-1", contactType: "REFERIDO_DE_BROKER" },
  { id: "ref-cliente", deletedAt: null, assignedToId: "ase-1", contactType: "REFERIDO_DE_CLIENTE" },
  { id: "broker", deletedAt: null, assignedToId: "ase-1", contactType: "BROKER_EXTERNO" },
  { id: "sin-tipo", deletedAt: null, assignedToId: "ase-1", contactType: null },
  { id: "comprador-de-otro", deletedAt: null, assignedToId: "ase-9", contactType: "LEAD_COMPRADOR" },
];

const DIRECTOR = { id: "dir-1", role: "DIRECTOR", plaza: "CANCUN" };
const ASESOR = { id: "ase-1", role: "ASESOR", plaza: "CANCUN" };

beforeEach(() => {
  for (const m of [contactFindMany, contactCount, getServerSession]) m.mockReset();
  contactFindMany.mockResolvedValue([]);
  contactCount.mockResolvedValue(0);
});

async function visibles(user: typeof DIRECTOR, qs: string): Promise<string[]> {
  getServerSession.mockResolvedValue({ user });
  const res = await GET(new Request(`https://x/api/contacts${qs}`) as never);
  expect(res.status).toBe(200);
  const where = contactFindMany.mock.calls.at(-1)![0].where as Fila;
  return FILAS.filter((f) => cumple(f, where)).map((f) => f.id as string);
}

describe("GET /api/contacts?type= (#938)", () => {
  const COMPRADORES = ["lead-comprador", "comprador-viejo", "lead-viejo", "inversionista-viejo", "comprador-de-otro"];

  it("«Lead Comprador» trae también a los que siguen con Lead, Comprador o Inversionista", async () => {
    expect(await visibles(DIRECTOR, "?type=LEAD_COMPRADOR")).toEqual(COMPRADORES);
  });

  it("un enlace viejo con ?type=COMPRADOR lista lo mismo", async () => {
    expect(await visibles(DIRECTOR, "?type=COMPRADOR")).toEqual(COMPRADORES);
  });

  it("los tipos nuevos sin equivalentes filtran solo lo suyo", async () => {
    expect(await visibles(DIRECTOR, "?type=LEAD_VENDEDOR")).toEqual(["vendedor"]);
    expect(await visibles(DIRECTOR, "?type=REFERIDO_DE_BROKER")).toEqual(["ref-broker"]);
    expect(await visibles(DIRECTOR, "?type=REFERIDO_DE_CLIENTE")).toEqual(["ref-cliente"]);
    expect(await visibles(DIRECTOR, "?type=SIN_TIPO")).toEqual(["sin-tipo"]);
  });

  it("no amplía el alcance del rol", async () => {
    expect(await visibles(ASESOR, "?type=LEAD_COMPRADOR")).toEqual(
      ["lead-comprador", "comprador-viejo", "lead-viejo", "inversionista-viejo"],
    );
  });
});

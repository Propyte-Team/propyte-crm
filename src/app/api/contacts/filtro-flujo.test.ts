// #951 — filtro «Flujo» de la lista de Contactos (seguimiento de #948).
//
// Medido sobre FILAS con el mismo evaluador de `where` que usan #881 y #919: `?flujo=` filtra por
// uno de los 8 flujos o por «Sin flujo» (NULL), y nunca amplía el alcance del rol.
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
  { id: "broker", deletedAt: null, assignedToId: "ase-1", flujo: "F6_BROKER" },
  { id: "comprador-f2", deletedAt: null, assignedToId: "ase-1", flujo: "F2_CORRETAJE_COMPRADOR" },
  { id: "sin-flujo", deletedAt: null, assignedToId: "ase-1", flujo: null },
  { id: "sin-flujo-otro", deletedAt: null, assignedToId: "ase-9", flujo: null },
  { id: "borrado", deletedAt: new Date(), assignedToId: "ase-1", flujo: null },
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

describe("GET /api/contacts?flujo= (#951)", () => {
  it("«Sin flujo» lista los que no tienen flujo (y no los borrados)", async () => {
    expect(await visibles(DIRECTOR, "?flujo=SIN_FLUJO")).toEqual(["sin-flujo", "sin-flujo-otro"]);
  });

  it("un flujo concreto lista solo esos", async () => {
    expect(await visibles(DIRECTOR, "?flujo=F6_BROKER")).toEqual(["broker"]);
    expect(await visibles(DIRECTOR, "?flujo=F2_CORRETAJE_COMPRADOR")).toEqual(["comprador-f2"]);
  });

  it("no amplía el alcance del rol: el asesor solo ve sus «Sin flujo»", async () => {
    expect(await visibles(ASESOR, "?flujo=SIN_FLUJO")).toEqual(["sin-flujo"]);
  });

  it("sin filtro o con un valor que no existe, no recorta por flujo", async () => {
    const todos = ["broker", "comprador-f2", "sin-flujo", "sin-flujo-otro"];
    expect(await visibles(DIRECTOR, "")).toEqual(todos);
    expect(await visibles(DIRECTOR, "?flujo=F9_INVENTADO")).toEqual(todos);
  });
});

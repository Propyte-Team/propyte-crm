// #919 — filtro «Asesores» de la lista de Contactos.
//
// Dos cosas, las dos medidas sobre FILAS con el mismo evaluador de `where` que usa la #881:
//  1. `?assignedTo=sin_asignar` filtra los que no tienen dueño, y se SUMA al alcance del rol.
//  2. GET /api/contacts/asesores ofrece solo a los dueños de lo que cada rol puede ver.
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.fn();
const contactCount = vi.fn();
const contactGroupBy = vi.fn();
const userFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      count: (...a: unknown[]) => contactCount(...a),
      groupBy: (...a: unknown[]) => contactGroupBy(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));
vi.mock("@/lib/api/orden", () => ({ ordenValidado: () => ({ orderBy: undefined, error: null }) }));
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: () => Promise.resolve("ALL") }));

import { GET as getContacts } from "./route";
import { GET as getAsesores } from "./asesores/route";
import { cumple, type Fila } from "@/lib/testing/cumple-where";

// ase-1 y ase-2 son de Cancún y del equipo de tl-1. ase-9 es de Playa, de otro equipo.
const FILAS: Fila[] = [
  { id: "de-ase-1", deletedAt: null, assignedToId: "ase-1", firstName: "Ana" },
  { id: "de-ase-1b", deletedAt: null, assignedToId: "ase-1", firstName: "Eva" },
  { id: "de-ase-2", deletedAt: null, assignedToId: "ase-2", firstName: "Beto" },
  { id: "de-ase-9", deletedAt: null, assignedToId: "ase-9", firstName: "Ana" },
  { id: "sin-dueno", deletedAt: null, assignedToId: null, firstName: "Dani" },
  { id: "borrado", deletedAt: new Date(), assignedToId: null, firstName: "Zoe" },
];

const USUARIOS = [
  { id: "ase-1", name: "Victor Arroyo", plaza: "CANCUN", teamLeaderId: "tl-1", isActive: true },
  { id: "ase-2", name: "Ignacio Lencinas", plaza: "CANCUN", teamLeaderId: "tl-1", isActive: true },
  { id: "tl-1", name: "Laura TL", plaza: "CANCUN", teamLeaderId: null, isActive: true },
  { id: "ase-9", name: "Sonia Cervantes", plaza: "PLAYA", teamLeaderId: "tl-9", isActive: true },
];

const SESIONES: Record<string, { id: string; role: string; plaza: string }> = {
  asesor: { id: "ase-1", role: "ASESOR", plaza: "CANCUN" },
  lider: { id: "tl-1", role: "TEAM_LEADER", plaza: "CANCUN" },
  gerente: { id: "ger-1", role: "GERENTE", plaza: "CANCUN" },
  director: { id: "dir-1", role: "DIRECTOR", plaza: "CANCUN" },
};

beforeEach(() => {
  for (const m of [contactFindMany, contactCount, contactGroupBy, userFindMany, getServerSession]) m.mockReset();
  contactFindMany.mockResolvedValue([]);
  contactCount.mockResolvedValue(0);
  userFindMany.mockImplementation(async ({ where }: { where: Fila & { id?: { in: string[] } } }) =>
    USUARIOS.filter((u) =>
      Object.entries(where).every(([k, v]) => {
        if (k === "isActive") return true;
        if (k === "id") return (v as { in: string[] }).in.includes(u.id);
        return (u as Fila)[k] === v;
      }),
    ),
  );
  // groupBy por assignedToId sobre las filas que cumplen el `where` (como lo haría Postgres).
  contactGroupBy.mockImplementation(async ({ where }: { where: Fila }) => {
    const conteo = new Map<string | null, number>();
    for (const f of FILAS.filter((f) => cumple(f, where))) {
      const k = (f.assignedToId as string | null) ?? null;
      conteo.set(k, (conteo.get(k) ?? 0) + 1);
    }
    return [...conteo].map(([assignedToId, n]) => ({ assignedToId, _count: { _all: n } }));
  });
});

async function visibles(quien: string, qs: string): Promise<string[]> {
  getServerSession.mockResolvedValue({ user: SESIONES[quien] });
  const res = await getContacts(new Request(`https://x/api/contacts${qs}`) as never);
  expect(res.status).toBe(200);
  const where = contactFindMany.mock.calls.at(-1)![0].where as Fila;
  return FILAS.filter((f) => cumple(f, where)).map((f) => f.id as string);
}

async function opciones(quien: string) {
  getServerSession.mockResolvedValue({ user: SESIONES[quien] });
  const res = await getAsesores();
  expect(res.status).toBe(200);
  return (await res.json()) as { data: { id: string; name: string; total: number }[]; sinAsignar: number };
}

describe("GET /api/contacts?assignedTo=sin_asignar (#919)", () => {
  it("director: solo los que no tienen dueño (y no los borrados)", async () => {
    expect(await visibles("director", "?assignedTo=sin_asignar")).toEqual(["sin-dueno"]);
  });

  it("gerente: también ve los sin dueño, como ya los veía en su lista", async () => {
    expect(await visibles("gerente", "?assignedTo=sin_asignar")).toEqual(["sin-dueno"]);
  });

  it("asesor y líder: no amplía su alcance; lista vacía", async () => {
    expect(await visibles("asesor", "?assignedTo=sin_asignar")).toEqual([]);
    expect(await visibles("lider", "?assignedTo=sin_asignar")).toEqual([]);
  });

  it("por id sigue funcionando y sigue respetando el alcance (#881)", async () => {
    expect(await visibles("director", "?assignedTo=ase-1")).toEqual(["de-ase-1", "de-ase-1b"]);
    expect(await visibles("lider", "?assignedTo=ase-9")).toEqual([]);
  });
});

describe("GET /api/contacts/asesores — las opciones del filtro (#919)", () => {
  it("director: todos los dueños, por nombre, con su conteo, y los sin asignar", async () => {
    const r = await opciones("director");
    expect(r.data).toEqual([
      { id: "ase-2", name: "Ignacio Lencinas", isActive: true, total: 1 },
      { id: "ase-9", name: "Sonia Cervantes", isActive: true, total: 1 },
      { id: "ase-1", name: "Victor Arroyo", isActive: true, total: 2 },
    ]);
    expect(r.sinAsignar).toBe(1);
  });

  it("gerente: solo los de su plaza (más los sin asignar)", async () => {
    const r = await opciones("gerente");
    expect(r.data.map((a) => a.id)).toEqual(["ase-2", "ase-1"]);
    expect(r.sinAsignar).toBe(1);
  });

  it("líder: solo su equipo, sin los sin asignar", async () => {
    const r = await opciones("lider");
    expect(r.data.map((a) => a.id)).toEqual(["ase-2", "ase-1"]);
    expect(r.sinAsignar).toBe(0);
  });

  it("asesor: solo él mismo (el filtro no se le muestra)", async () => {
    const r = await opciones("asesor");
    expect(r.data.map((a) => a.id)).toEqual(["ase-1"]);
    expect(r.sinAsignar).toBe(0);
  });

  it("sin sesión: 401", async () => {
    getServerSession.mockResolvedValue(null);
    expect((await getAsesores()).status).toBe(401);
  });
});

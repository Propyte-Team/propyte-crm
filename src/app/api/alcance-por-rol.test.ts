// #881 — el filtro por asesor que llega en la URL no puede AMPLIAR el alcance del rol.
//
// `GET /api/contacts?assignedTo=` y `GET /api/deals?advisorId=` asignaban
// `where.assignedToId = <valor de la URL>` DESPUÉS de que la rama del rol pusiera
// `where.assignedToId = userId` (asesor) o `{ in: equipo }` (líder de equipo). La clave se
// pisaba y un asesor listaba los contactos y negocios de cualquier otro cambiando la URL.
//
// Estas pruebas no miran la FORMA del `where` (eso es lo que se rompió: dos formas distintas
// pueden significar lo mismo, y una forma "razonable" puede significar otra cosa). Lo aplican
// a un puñado de filas con un evaluador mínimo de filtros de Prisma y comparan QUÉ FILAS
// saldrían. El evaluador lanza ante un operador que no conoce, para que un cambio de forma
// futuro haga fallar la prueba en vez de pasarla en silencio.
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.fn();
const contactCount = vi.fn();
const dealFindMany = vi.fn();
const dealCount = vi.fn();
const userFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      count: (...a: unknown[]) => contactCount(...a),
    },
    deal: {
      findMany: (...a: unknown[]) => dealFindMany(...a),
      count: (...a: unknown[]) => dealCount(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));
vi.mock("@/lib/api/orden", () => ({ ordenValidado: () => ({ orderBy: undefined, error: null }) }));
// "ALL": sin recorte de marca. La marca ya tiene sus propias pruebas (route.marcas.test.ts);
// aquí se aísla el alcance por ROL.
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: () => Promise.resolve("ALL") }));

import { GET as getContacts } from "./contacts/route";
import { GET as getDeals } from "./deals/route";

// ── Evaluador mínimo de un `where` de Prisma sobre una fila en memoria ─────────────────────
type Fila = Record<string, unknown>;
const OPERADORES = new Set(["in", "equals", "contains", "mode", "not"]);

function esOperador(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).some((k) => OPERADORES.has(k));
}

function cumpleCampo(valor: unknown, filtro: unknown): boolean {
  if (filtro === undefined) return true; // Prisma ignora las claves undefined
  if (filtro === null) return valor === null || valor === undefined;
  if (esOperador(filtro)) {
    for (const [op, arg] of Object.entries(filtro)) {
      if (op === "mode") continue;
      if (op === "in" && !(arg as unknown[]).includes(valor)) return false;
      if (op === "equals" && valor !== arg) return false;
      if (op === "not" && !(arg === null ? valor !== null && valor !== undefined : valor !== arg)) return false;
      if (op === "contains") {
        if (typeof valor !== "string") return false;
        const insensible = (filtro as { mode?: string }).mode === "insensitive";
        const a = insensible ? valor.toLowerCase() : valor;
        const b = insensible ? String(arg).toLowerCase() : String(arg);
        if (!a.includes(b)) return false;
      }
    }
    return true;
  }
  if (typeof filtro === "object") {
    // Filtro de relación 1-1 (p. ej. `assignedTo: { plaza }`).
    if (typeof valor !== "object" || valor === null) return false;
    return cumple(valor as Fila, filtro as Fila);
  }
  return valor === filtro;
}

function cumple(fila: Fila, where: Fila): boolean {
  for (const [clave, filtro] of Object.entries(where)) {
    if (filtro === undefined) continue;
    const lista = (f: unknown) => (Array.isArray(f) ? f : [f]) as Fila[];
    if (clave === "AND") {
      if (!lista(filtro).every((w) => cumple(fila, w))) return false;
    } else if (clave === "OR") {
      if (!(filtro as Fila[]).some((w) => cumple(fila, w))) return false;
    } else if (clave === "NOT") {
      if (lista(filtro).some((w) => cumple(fila, w))) return false;
    } else if (!(clave in fila)) {
      throw new Error(`El evaluador de la prueba no conoce el campo «${clave}»: amplía las filas`);
    } else if (!cumpleCampo(fila[clave], filtro)) {
      return false;
    }
  }
  return true;
}

// ── Escenario ──────────────────────────────────────────────────────────────────────────────
// ase-1 y ase-2 son de Cancún y del equipo de tl-1. ase-9 es de Playa, de otro equipo.
const FILAS: Fila[] = [
  { id: "de-ase-1", deletedAt: null, assignedToId: "ase-1", assignedTo: { plaza: "CANCUN" }, firstName: "Ana" },
  { id: "de-ase-2", deletedAt: null, assignedToId: "ase-2", assignedTo: { plaza: "CANCUN" }, firstName: "Beto" },
  { id: "de-tl-1", deletedAt: null, assignedToId: "tl-1", assignedTo: { plaza: "CANCUN" }, firstName: "Ceci" },
  { id: "de-ase-9", deletedAt: null, assignedToId: "ase-9", assignedTo: { plaza: "PLAYA" }, firstName: "Ana" },
  { id: "sin-dueno", deletedAt: null, assignedToId: null, assignedTo: null, firstName: "Dani" },
];

const USUARIOS = [
  { id: "ase-1", plaza: "CANCUN", teamLeaderId: "tl-1" },
  { id: "ase-2", plaza: "CANCUN", teamLeaderId: "tl-1" },
  { id: "tl-1", plaza: "CANCUN", teamLeaderId: null },
  { id: "ase-9", plaza: "PLAYA", teamLeaderId: "tl-9" },
];

const SESIONES: Record<string, { id: string; role: string; plaza: string }> = {
  asesor: { id: "ase-1", role: "ASESOR", plaza: "CANCUN" },
  asesorSr: { id: "ase-1", role: "ASESOR_SR", plaza: "CANCUN" },
  broker: { id: "ase-1", role: "BROKER", plaza: "CANCUN" },
  lider: { id: "tl-1", role: "TEAM_LEADER", plaza: "CANCUN" },
  gerente: { id: "ger-1", role: "GERENTE", plaza: "CANCUN" },
  director: { id: "dir-1", role: "DIRECTOR", plaza: "CANCUN" },
  hostess: { id: "ase-1", role: "HOSTESS", plaza: "CANCUN" },
  marketing: { id: "mkt-1", role: "MARKETING", plaza: "CANCUN" },
};

beforeEach(() => {
  for (const m of [contactFindMany, contactCount, dealFindMany, dealCount, userFindMany, getServerSession]) {
    m.mockReset();
  }
  contactFindMany.mockResolvedValue([]);
  contactCount.mockResolvedValue(0);
  dealFindMany.mockResolvedValue([]);
  dealCount.mockResolvedValue(0);
  // La ruta busca usuarios por equipo (`teamLeaderId`) o por plaza (`plaza` + `isActive`).
  userFindMany.mockImplementation(async ({ where }: { where: Fila }) =>
    USUARIOS.filter((u) =>
      Object.entries(where).every(([k, v]) => k === "isActive" || (u as Fila)[k] === v),
    ).map((u) => ({ id: u.id })),
  );
});

async function visibles(ruta: "contacts" | "deals", quien: string, qs = ""): Promise<string[]> {
  getServerSession.mockResolvedValue({ user: SESIONES[quien] });
  const res =
    ruta === "contacts"
      ? await getContacts(new Request(`https://x/api/contacts${qs}`) as never)
      : await getDeals(new Request(`https://x/api/deals${qs}`) as never);
  expect(res.status).toBe(200);
  const findMany = ruta === "contacts" ? contactFindMany : dealFindMany;
  const count = ruta === "contacts" ? contactCount : dealCount;
  const where = findMany.mock.calls[0][0].where as Fila;
  // La lista y el total usan el mismo filtro: si no, el paginador mentiría sobre lo que hay.
  expect(count.mock.calls[0][0].where).toBe(where);
  return FILAS.filter((f) => cumple(f, where)).map((f) => f.id as string);
}

// ── Contactos: ?assignedTo= ────────────────────────────────────────────────────────────────
describe("GET /api/contacts — ?assignedTo= no amplía el alcance del rol (#881)", () => {
  it.each(["asesor", "asesorSr", "broker"])("%s: pedir los de otro asesor no devuelve nada", async (quien) => {
    expect(await visibles("contacts", quien, "?assignedTo=ase-9")).toEqual([]);
  });

  it("asesor: pedir los propios sigue funcionando", async () => {
    expect(await visibles("contacts", "asesor", "?assignedTo=ase-1")).toEqual(["de-ase-1"]);
  });

  it("asesor: sin parámetro ve solo lo suyo", async () => {
    expect(await visibles("contacts", "asesor")).toEqual(["de-ase-1"]);
  });

  it("asesor: con búsqueda + asesor ajeno tampoco se escapa", async () => {
    expect(await visibles("contacts", "asesor", "?search=ana&assignedTo=ase-9")).toEqual([]);
  });

  it("líder de equipo: pedir a alguien de otro equipo no devuelve nada", async () => {
    expect(await visibles("contacts", "lider", "?assignedTo=ase-9")).toEqual([]);
  });

  it("líder de equipo: filtrar por alguien de SU equipo sigue funcionando", async () => {
    expect(await visibles("contacts", "lider", "?assignedTo=ase-2")).toEqual(["de-ase-2"]);
  });

  it("gerente: un asesor de otra plaza no devuelve nada (ya era correcto)", async () => {
    expect(await visibles("contacts", "gerente", "?assignedTo=ase-9")).toEqual([]);
  });

  it("gerente: un asesor de su plaza sí", async () => {
    expect(await visibles("contacts", "gerente", "?assignedTo=ase-2")).toEqual(["de-ase-2"]);
  });

  it.each(["director", "marketing"])("%s (ve todo por rol): el filtro solo acota", async (quien) => {
    expect(await visibles("contacts", quien, "?assignedTo=ase-9")).toEqual(["de-ase-9"]);
  });
});

// ── Negocios: ?advisorId= ──────────────────────────────────────────────────────────────────
describe("GET /api/deals — ?advisorId= no amplía el alcance del rol (#881)", () => {
  it.each(["asesor", "asesorSr", "broker"])("%s: pedir los de otro asesor no devuelve nada", async (quien) => {
    expect(await visibles("deals", quien, "?advisorId=ase-9")).toEqual([]);
  });

  it("asesor: pedir los propios sigue funcionando", async () => {
    expect(await visibles("deals", "asesor", "?advisorId=ase-1")).toEqual(["de-ase-1"]);
  });

  it("líder de equipo: pedir a alguien de otro equipo no devuelve nada", async () => {
    expect(await visibles("deals", "lider", "?advisorId=ase-9")).toEqual([]);
  });

  it("líder de equipo: filtrar por alguien de SU equipo sigue funcionando", async () => {
    expect(await visibles("deals", "lider", "?advisorId=ase-2")).toEqual(["de-ase-2"]);
  });

  it("solo lectura acotado a lo suyo (HOSTESS): pedir a otro no devuelve nada", async () => {
    expect(await visibles("deals", "hostess", "?advisorId=ase-9")).toEqual([]);
  });

  it("gerente: un asesor de otra plaza no devuelve nada (ya era correcto)", async () => {
    expect(await visibles("deals", "gerente", "?advisorId=ase-9")).toEqual([]);
  });

  it("director (ve todo por rol): el filtro solo acota", async () => {
    expect(await visibles("deals", "director", "?advisorId=ase-9")).toEqual(["de-ase-9"]);
  });
});

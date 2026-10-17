// #881 (2026-10-14): el filtro por asesor que llega en la URL (o en los argumentos de una acción de
// servidor) se SUMA al alcance por rol, nunca lo reemplaza. Antes, `?assignedTo=` en Contactos,
// `?advisorId=` en Negocios y `?hostessId=` / `?advisorId=` en Visitas se asignaban encima del
// `= yo` del asesor y del `in: equipo` del líder: cualquiera listaba lo de otro cambiando la URL.
//
// Estas pruebas no miran la forma del `where` sino lo que DEVUELVE: prisma simulado filtra una
// tabla pequeña con el `where` que arma la ruta (evaluador mínimo de abajo). Así un cambio de forma
// que siga siendo correcto no las rompe, y una fuga sí.
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock se eleva al principio del archivo: la tabla y el evaluador tienen que existir antes.
const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  /** Evaluador mínimo del `where` de Prisma: igualdad, null, in, AND/OR/NOT y relaciones uno a uno. */
  function cumple(row: Row, where: unknown): boolean {
    if (!where || typeof where !== "object") return true;
    for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
      if (cond === undefined) continue;
      if (key === "AND") {
        if (!(Array.isArray(cond) ? cond : [cond]).every((w) => cumple(row, w))) return false;
        continue;
      }
      if (key === "OR") {
        if (!(cond as unknown[]).some((w) => cumple(row, w))) return false;
        continue;
      }
      if (key === "NOT") {
        if ((Array.isArray(cond) ? cond : [cond]).some((w) => cumple(row, w))) return false;
        continue;
      }
      const value = row[key];
      if (cond === null) {
        if (value !== null && value !== undefined) return false;
        continue;
      }
      if (typeof cond === "object" && !(cond instanceof Date)) {
        const c = cond as Record<string, unknown>;
        if ("in" in c) {
          if (!(c.in as unknown[]).includes(value)) return false;
          continue;
        }
        if ("gte" in c || "lte" in c || "lt" in c || "gt" in c) continue; // fechas: fuera de estas pruebas
        if (value && typeof value === "object") {
          if (!cumple(value as Row, c)) return false;
          continue;
        }
        return false;
      }
      if (value !== cond) return false;
    }
    return true;
  }

  const USERS: Row[] = [
    { id: "ana", role: "ASESOR_SR", plaza: "CANCUN", teamLeaderId: "tl-1", isActive: true },
    { id: "beto", role: "ASESOR_SR", plaza: "CANCUN", teamLeaderId: "tl-1", isActive: true },
    { id: "caro", role: "ASESOR_JR", plaza: "PDC", teamLeaderId: "tl-2", isActive: true },
    { id: "tl-1", role: "TEAM_LEADER", plaza: "CANCUN", teamLeaderId: null, isActive: true },
    { id: "ger-1", role: "GERENTE", plaza: "CANCUN", teamLeaderId: null, isActive: true },
  ];
  const plazaDe = (id: string | null) => (USERS.find((u) => u.id === id)?.plaza as string | undefined) ?? null;

  const CONTACTS: Row[] = ["ana", "beto", "caro", "tl-1", null].map((owner) => ({
    id: `c-${owner ?? "libre"}`,
    assignedToId: owner,
    deletedAt: null,
  }));
  const DEALS: Row[] = ["ana", "beto", "caro", "tl-1"].map((owner) => ({
    id: `d-${owner}`,
    assignedToId: owner,
    assignedTo: { plaza: plazaDe(owner), name: owner },
    deletedAt: null,
    stage: "WON",
    commissionStatus: "PENDIENTE",
    contact: { firstName: "X", lastName: "Y" },
    development: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    actualCloseDate: null,
  }));
  const WALK_INS: Row[] = [
    { id: "w-ana", hostessId: "hos-1", assignedAdvisorId: "ana", deletedAt: null },
    { id: "w-beto", hostessId: "hos-2", assignedAdvisorId: "beto", deletedAt: null },
  ];
  // Tareas pendientes y vencidas: así sirven a la lista de actividades y a las tareas vencidas.
  const ACTIVITIES: Row[] = ["ana", "beto", "caro", "tl-1"].map((u) => ({
    id: `a-${u}`,
    userId: u,
    deletedAt: null,
    activityType: "TASK",
    status: "PENDIENTE",
    dueDate: new Date("2026-10-01T00:00:00Z"),
  }));

  const tabla = (rows: Row[]) => ({
    findMany: vi.fn(async ({ where }: { where?: unknown } = {}) => rows.filter((r) => cumple(r, where))),
    count: vi.fn(async ({ where }: { where?: unknown } = {}) => rows.filter((r) => cumple(r, where)).length),
    groupBy: vi.fn(async () => []),
  });
  const db = {
    user: tabla(USERS),
    contact: tabla(CONTACTS),
    deal: tabla(DEALS),
    walkIn: tabla(WALK_INS),
    activity: tabla(ACTIVITIES),
  };

  return { cumple, USERS, plazaDe, db, estado: { session: null as { user: { id: string; role: string; plaza: string } } | null } };
});
const { plazaDe } = h;

vi.mock("@/lib/db", () => ({ default: h.db, prisma: h.db }));

vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => h.estado.session }));
// Sin marcas en juego: estas pruebas son del alcance por rol (la marca tiene las suyas).
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: async () => "ALL" }));

import { GET as getContactsRoute } from "@/app/api/contacts/route";
import { GET as getDealsRoute } from "@/app/api/deals/route";
import { GET as getWalkInsRoute } from "@/app/api/walk-ins/route";
import { getContacts } from "@/server/contacts";
import { getDeals } from "@/server/deals";
import { getCommissions } from "@/server/commissions";
import { getActivities, getOverdueTasks } from "@/server/activities";

const como = (id: string, role: string) => {
  h.estado.session = { user: { id, role, plaza: plazaDe(id) ?? "CANCUN" } };
};
async function ids(route: (r: never) => Promise<Response>, url: string): Promise<string[]> {
  const res = await route(new Request(`https://x${url}`) as never);
  expect(res.status).toBe(200);
  const json = (await res.json()) as { data: { id: string }[] };
  return json.data.map((d) => d.id).sort();
}

beforeEach(() => {
  h.estado.session = null;
});

describe("GET /api/contacts?assignedTo= (#881)", () => {
  const lista = (qs: string) => ids(getContactsRoute as never, `/api/contacts${qs}`);

  it("🚨 ASESOR pidiendo a otro asesor → nada", async () => {
    como("ana", "ASESOR_SR");
    expect(await lista("?assignedTo=beto")).toEqual([]);
  });
  it("ASESOR pidiéndose a sí mismo, o sin filtro → lo suyo", async () => {
    como("ana", "ASESOR_SR");
    expect(await lista("?assignedTo=ana")).toEqual(["c-ana"]);
    expect(await lista("")).toEqual(["c-ana"]);
  });
  it("TEAM_LEADER: dentro de su equipo filtra; fuera → nada", async () => {
    como("tl-1", "TEAM_LEADER");
    expect(await lista("?assignedTo=beto")).toEqual(["c-beto"]);
    expect(await lista("?assignedTo=caro")).toEqual([]);
  });
  it("GERENTE: filtra dentro de su plaza; un asesor de otra plaza → nada", async () => {
    como("ger-1", "GERENTE");
    expect(await lista("?assignedTo=beto")).toEqual(["c-beto"]);
    expect(await lista("?assignedTo=caro")).toEqual([]);
  });
  it("ADMIN y DIRECTOR filtran por cualquiera, como siempre", async () => {
    como("adm-1", "ADMIN");
    expect(await lista("?assignedTo=caro")).toEqual(["c-caro"]);
    como("dir-1", "DIRECTOR");
    expect(await lista("?assignedTo=beto")).toEqual(["c-beto"]);
  });
});

describe("GET /api/deals?advisorId= (#881)", () => {
  const lista = (qs: string) => ids(getDealsRoute as never, `/api/deals${qs}`);

  it("🚨 ASESOR pidiendo a otro asesor → nada", async () => {
    como("ana", "ASESOR_SR");
    expect(await lista("?advisorId=beto")).toEqual([]);
    expect(await lista("?advisorId=ana")).toEqual(["d-ana"]);
  });
  it("🚨 solo lectura (MARKETING) pidiendo a un asesor → nada (su alcance es lo suyo)", async () => {
    como("mkt-1", "MARKETING");
    expect(await lista("?advisorId=beto")).toEqual([]);
  });
  it("TEAM_LEADER: dentro de su equipo filtra; fuera → nada", async () => {
    como("tl-1", "TEAM_LEADER");
    expect(await lista("?advisorId=beto")).toEqual(["d-beto"]);
    expect(await lista("?advisorId=caro")).toEqual([]);
  });
  it("GERENTE: dentro de su plaza filtra; otra plaza → nada", async () => {
    como("ger-1", "GERENTE");
    expect(await lista("?advisorId=ana")).toEqual(["d-ana"]);
    expect(await lista("?advisorId=caro")).toEqual([]);
  });
  it("ADMIN filtra por cualquiera, como siempre", async () => {
    como("adm-1", "ADMIN");
    expect(await lista("?advisorId=caro")).toEqual(["d-caro"]);
  });
});

describe("GET /api/walk-ins?hostessId=&advisorId= (#881)", () => {
  const lista = (qs: string) => ids(getWalkInsRoute as never, `/api/walk-ins${qs}`);

  it("🚨 HOSTESS pidiendo las visitas de otra hostess → nada", async () => {
    como("hos-1", "HOSTESS");
    expect(await lista("?hostessId=hos-2")).toEqual([]);
    expect(await lista("")).toEqual(["w-ana"]);
  });
  it("🚨 asesor pidiendo las visitas de otro asesor → nada", async () => {
    como("ana", "ASESOR_SR");
    expect(await lista("?advisorId=beto")).toEqual([]);
    expect(await lista("?advisorId=ana")).toEqual(["w-ana"]);
  });
  it("GERENTE filtra por asesor y por hostess, como siempre", async () => {
    como("ger-1", "GERENTE");
    expect(await lista("?advisorId=beto")).toEqual(["w-beto"]);
    expect(await lista("?hostessId=hos-1")).toEqual(["w-ana"]);
  });
});

// Acciones de servidor ("use server"): sus argumentos los puede mandar cualquiera, igual que una URL.
describe("acciones de servidor con filtro por asesor (#881)", () => {
  const idsDe = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

  it("🚨 getContacts({ assignedTo }) de un ASESOR → solo lo suyo", async () => {
    como("ana", "ASESOR_SR");
    expect(idsDe((await getContacts({ assignedTo: "beto" })).contacts)).toEqual([]);
    como("tl-1", "TEAM_LEADER");
    expect(idsDe((await getContacts({ assignedTo: "beto" })).contacts)).toEqual(["c-beto"]);
    expect(idsDe((await getContacts({ assignedTo: "caro" })).contacts)).toEqual([]);
    como("adm-1", "ADMIN");
    expect(idsDe((await getContacts({ assignedTo: "caro" })).contacts)).toEqual(["c-caro"]);
  });

  it("🚨 getDeals({ assignedToId }) de un ASESOR → solo lo suyo", async () => {
    como("ana", "ASESOR_SR");
    expect(idsDe((await getDeals({ assignedToId: "beto" })).deals)).toEqual([]);
    como("tl-1", "TEAM_LEADER");
    expect(idsDe((await getDeals({ assignedToId: "beto" })).deals)).toEqual(["d-beto"]);
    expect(idsDe((await getDeals({ assignedToId: "caro" })).deals)).toEqual([]);
  });

  it("🚨 getCommissions({ userId }) de un ASESOR → solo lo suyo", async () => {
    como("ana", "ASESOR_SR");
    expect(idsDe((await getCommissions({ userId: "beto" })).commissions)).toEqual([]);
    como("tl-1", "TEAM_LEADER");
    expect(idsDe((await getCommissions({ userId: "beto" })).commissions)).toEqual(["d-beto"]);
    como("ger-1", "GERENTE");
    expect(idsDe((await getCommissions({ userId: "caro" })).commissions)).toEqual([]);
  });

  it("🚨 getActivities({ userId }) de un ASESOR → solo lo suyo", async () => {
    como("ana", "ASESOR_SR");
    expect(idsDe((await getActivities({ userId: "beto" })).data)).toEqual([]);
    como("tl-1", "TEAM_LEADER");
    expect(idsDe((await getActivities({ userId: "beto" })).data)).toEqual(["a-beto"]);
    expect(idsDe((await getActivities({ userId: "caro" })).data)).toEqual([]);
  });

  it("getOverdueTasks(userId) ya no amplía el alcance del rol", async () => {
    como("ana", "ASESOR_SR");
    expect(idsDe(await getOverdueTasks("beto"))).toEqual([]);
    expect(idsDe(await getOverdueTasks("ana"))).toEqual(["a-ana"]);
  });
});

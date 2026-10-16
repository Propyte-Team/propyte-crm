// #895 — Metas: quién ve y quién fija qué.
//
// Regla que definió sistemas@ (2026-10-16):
//   · Todos ven las metas de la EMPRESA. Solo ADMIN y DIRECTOR las crean o borran.
//   · Un asesor (y MARKETING, HOSTESS, etc.) ve sus propias metas y las de la empresa.
//   · TEAM_LEADER ve y fija las de su equipo (`User.teamLeaderId`, y los equipos que encabeza).
//   · GERENTE ve y fija las de cualquier persona o equipo de SU plaza; de otras plazas, nada.
//   · ADMIN y DIRECTOR, todo.
//
// Antes: el GET solo forzaba `userId = yo` a los roles de asesor; TEAM_LEADER, GERENTE y
// MARKETING pedían `?userId=` o `?teamId=` de quien fuera. El POST y el DELETE dejaban a
// GERENTE y TEAM_LEADER fijar metas de cualquiera, incluidas las de la empresa, y borrar
// cualquier meta por id.
//
// Como en la #881, las pruebas no miran la forma del `where`: lo aplican a filas en memoria
// (lib/testing/cumple-where) y comparan qué metas salen o qué escritura se permite.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { cumple, type Fila } from "@/lib/testing/cumple-where";

// ── Escenario ──────────────────────────────────────────────────────────────────────────────
// Cancún: tl-1 encabeza a ase-1 y ase-2 (y el equipo team-1). ger-1 es el gerente de Cancún.
// Playa: tl-9 encabeza a ase-9 (y el equipo team-9).
const OCT = new Date(Date.UTC(2026, 9, 1));
const SEP = new Date(Date.UTC(2026, 8, 1));

const USUARIOS: Fila[] = [
  { id: "ase-1", deletedAt: null, plaza: "CANCUN", teamLeaderId: "tl-1" },
  { id: "ase-2", deletedAt: null, plaza: "CANCUN", teamLeaderId: "tl-1" },
  { id: "tl-1", deletedAt: null, plaza: "CANCUN", teamLeaderId: null },
  { id: "ger-1", deletedAt: null, plaza: "CANCUN", teamLeaderId: null },
  { id: "ase-9", deletedAt: null, plaza: "PLAYA", teamLeaderId: "tl-9" },
  { id: "tl-9", deletedAt: null, plaza: "PLAYA", teamLeaderId: null },
];
const EQUIPOS: Fila[] = [
  { id: "team-1", deletedAt: null, plaza: "CANCUN", leaderId: "tl-1" },
  { id: "team-9", deletedAt: null, plaza: "PLAYA", leaderId: "tl-9" },
];
const usuario = (id: string) => USUARIOS.find((u) => u.id === id)!;
const equipo = (id: string) => EQUIPOS.find((t) => t.id === id)!;

function meta(id: string, scope: string, ref: string | null, period = OCT): Fila {
  return {
    id,
    deletedAt: null,
    period,
    scope,
    metric: "NEGOCIOS_CREADOS",
    target: 10,
    currency: null,
    userId: scope === "USER" ? ref : null,
    teamId: scope === "TEAM" ? ref : null,
    user: scope === "USER" ? usuario(ref!) : null,
    team: scope === "TEAM" ? equipo(ref!) : null,
  };
}

const METAS: Fila[] = [
  meta("g-empresa", "COMPANY", null),
  meta("g-ase-1", "USER", "ase-1"),
  meta("g-ase-2", "USER", "ase-2"),
  meta("g-tl-1", "USER", "tl-1"),
  meta("g-ger-1", "USER", "ger-1"),
  meta("g-ase-9", "USER", "ase-9"),
  meta("g-team-1", "TEAM", "team-1"),
  meta("g-team-9", "TEAM", "team-9"),
  meta("g-empresa-sep", "COMPANY", null, SEP),
];

// ── Mocks ──────────────────────────────────────────────────────────────────────────────────
const goalCreate = vi.fn();
const goalUpdate = vi.fn();
const filtrar = (filas: Fila[]) => ({ where }: { where: Fila }) => filas.filter((f) => cumple(f, where));

vi.mock("@/lib/db", () => ({
  default: {
    goal: {
      findMany: async (a: { where: Fila }) => filtrar(METAS)(a),
      findFirst: async (a: { where: Fila }) => filtrar(METAS)(a)[0] ?? null,
      create: (...a: unknown[]) => goalCreate(...a),
      update: (...a: unknown[]) => goalUpdate(...a),
    },
    user: {
      count: async (a: { where: Fila }) => filtrar(USUARIOS)(a).length,
      findFirst: async (a: { where: Fila }) => filtrar(USUARIOS)(a)[0] ?? null,
    },
    team: {
      count: async (a: { where: Fila }) => filtrar(EQUIPOS)(a).length,
      findFirst: async (a: { where: Fila }) => filtrar(EQUIPOS)(a)[0] ?? null,
    },
    // El avance (computeActual) no importa aquí: todo cuenta 0.
    teamMember: { findMany: async () => [] },
    contact: { count: async () => 0 },
    deal: { count: async () => 0, aggregate: async () => ({ _sum: { estimatedValue: 0 } }) },
    quote: { count: async () => 0 },
    activity: { count: async () => 0 },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

import { GET as scorecard } from "./scorecard/route";
import { POST as crear } from "./route";
import { DELETE as borrar } from "./[id]/route";

const SESIONES: Record<string, { id: string; role: string; plaza: string }> = {
  asesor: { id: "ase-1", role: "ASESOR", plaza: "CANCUN" },
  asesorSr: { id: "ase-1", role: "ASESOR_SR", plaza: "CANCUN" },
  lider: { id: "tl-1", role: "TEAM_LEADER", plaza: "CANCUN" },
  gerente: { id: "ger-1", role: "GERENTE", plaza: "CANCUN" },
  marketing: { id: "mkt-1", role: "MARKETING", plaza: "CANCUN" },
  director: { id: "dir-1", role: "DIRECTOR", plaza: "CANCUN" },
  admin: { id: "adm-1", role: "ADMIN", plaza: "CANCUN" },
};

beforeEach(() => {
  goalCreate.mockReset().mockResolvedValue({ id: "nueva" });
  goalUpdate.mockReset().mockResolvedValue({ id: "x" });
  getServerSession.mockReset();
});

function como(quien: string) {
  getServerSession.mockResolvedValue({ user: SESIONES[quien] });
}

async function visibles(quien: string, qs = ""): Promise<string[]> {
  como(quien);
  const res = await scorecard(new NextRequest(`https://x/api/goals/scorecard?period=2026-10${qs}`) as never);
  expect(res.status).toBe(200);
  const j = await res.json();
  return (j.data as { goal: { id: string } }[]).map((r) => r.goal.id).sort();
}

async function fijar(quien: string, body: Record<string, unknown>): Promise<number> {
  como(quien);
  const res = await crear(
    new NextRequest("https://x/api/goals", {
      method: "POST",
      body: JSON.stringify({ period: "2026-10", metric: "NEGOCIOS_CREADOS", target: 5, ...body }),
    }) as never,
  );
  return res.status;
}

async function quitar(quien: string, id: string): Promise<number> {
  como(quien);
  const res = await borrar(new NextRequest(`https://x/api/goals/${id}`, { method: "DELETE" }) as never, {
    params: Promise.resolve({ id }),
  });
  return res.status;
}

// ── Ver ────────────────────────────────────────────────────────────────────────────────────
describe("GET /api/goals/scorecard — quién ve qué (#895)", () => {
  it.each(["asesor", "asesorSr", "lider", "gerente", "marketing", "director", "admin"])(
    "%s: ve las metas de la empresa del mes (?scope=COMPANY)",
    async (quien) => {
      expect(await visibles(quien, "&scope=COMPANY")).toEqual(["g-empresa"]);
    },
  );

  it("sin filtros («Mi avance»): lo propio + la empresa, para cualquier rol", async () => {
    expect(await visibles("asesor")).toEqual(["g-ase-1", "g-empresa"]);
    expect(await visibles("lider")).toEqual(["g-empresa", "g-tl-1"]);
    expect(await visibles("director")).toEqual(["g-empresa"]);
    expect(await visibles("marketing")).toEqual(["g-empresa"]);
  });

  it("asesor: pedir a otro asesor o a un equipo no devuelve nada", async () => {
    expect(await visibles("asesor", "&userId=ase-2")).toEqual([]);
    expect(await visibles("asesor", "&teamId=team-1")).toEqual([]);
    expect(await visibles("asesor", "&userId=ase-1")).toEqual(["g-ase-1"]);
  });

  it("marketing: solo lo suyo y la empresa; nadie más", async () => {
    expect(await visibles("marketing", "&userId=ase-9")).toEqual([]);
    expect(await visibles("marketing", "&teamId=team-9")).toEqual([]);
  });

  it("líder de equipo: ve a los suyos y a su equipo", async () => {
    expect(await visibles("lider", "&userId=ase-2")).toEqual(["g-ase-2"]);
    expect(await visibles("lider", "&teamId=team-1")).toEqual(["g-team-1"]);
  });

  it("líder de equipo: NO ve a gente ni equipos de otros", async () => {
    expect(await visibles("lider", "&userId=ase-9")).toEqual([]);
    expect(await visibles("lider", "&teamId=team-9")).toEqual([]);
    expect(await visibles("lider", "&userId=ger-1")).toEqual([]);
  });

  it("gerente: ve a cualquier persona o equipo de su plaza", async () => {
    expect(await visibles("gerente", "&userId=ase-2")).toEqual(["g-ase-2"]);
    expect(await visibles("gerente", "&userId=tl-1")).toEqual(["g-tl-1"]);
    expect(await visibles("gerente", "&teamId=team-1")).toEqual(["g-team-1"]);
  });

  it("gerente: NO ve personas ni equipos de otra plaza", async () => {
    expect(await visibles("gerente", "&userId=ase-9")).toEqual([]);
    expect(await visibles("gerente", "&teamId=team-9")).toEqual([]);
  });

  it("director: ve a cualquiera", async () => {
    expect(await visibles("director", "&userId=ase-9")).toEqual(["g-ase-9"]);
    expect(await visibles("director", "&teamId=team-9")).toEqual(["g-team-9"]);
  });

  it("un scope inválido es 400, no se ignora", async () => {
    como("director");
    const res = await scorecard(new NextRequest("https://x/api/goals/scorecard?period=2026-10&scope=X") as never);
    expect(res.status).toBe(400);
  });
});

// ── Fijar ──────────────────────────────────────────────────────────────────────────────────
describe("POST /api/goals — quién fija qué (#895)", () => {
  it.each(["admin", "director"])("%s: puede fijar metas de la empresa", async (quien) => {
    expect(await fijar(quien, { scope: "COMPANY" })).toBe(201);
  });

  it.each(["gerente", "lider", "asesor", "marketing"])("%s: NO puede fijar metas de la empresa", async (quien) => {
    expect(await fijar(quien, { scope: "COMPANY" })).toBe(403);
    expect(goalCreate).not.toHaveBeenCalled();
  });

  it("líder: fija a los suyos y a su equipo, no a otros", async () => {
    expect(await fijar("lider", { scope: "USER", userId: "ase-2" })).toBe(201);
    expect(await fijar("lider", { scope: "TEAM", teamId: "team-1" })).toBe(201);
    goalCreate.mockClear();
    expect(await fijar("lider", { scope: "USER", userId: "ase-9" })).toBe(403);
    expect(await fijar("lider", { scope: "TEAM", teamId: "team-9" })).toBe(403);
    expect(goalCreate).not.toHaveBeenCalled();
  });

  it("gerente: fija a gente y equipos de su plaza, no de otra", async () => {
    expect(await fijar("gerente", { scope: "USER", userId: "tl-1" })).toBe(201);
    expect(await fijar("gerente", { scope: "TEAM", teamId: "team-1" })).toBe(201);
    goalCreate.mockClear();
    expect(await fijar("gerente", { scope: "USER", userId: "ase-9" })).toBe(403);
    expect(await fijar("gerente", { scope: "TEAM", teamId: "team-9" })).toBe(403);
    expect(goalCreate).not.toHaveBeenCalled();
  });

  it("asesor: no fija metas, ni la suya", async () => {
    expect(await fijar("asesor", { scope: "USER", userId: "ase-1" })).toBe(403);
  });

  it("una persona que no existe es 403 (no confirma si existe)", async () => {
    expect(await fijar("director", { scope: "USER", userId: "fantasma" })).toBe(403);
  });

  it("scope o métrica inválidos son 400, no un 500 de la base", async () => {
    expect(await fijar("director", { scope: "PLANETA" })).toBe(400);
    expect(await fijar("director", { scope: "COMPANY", metric: "INVENTADA" })).toBe(400);
  });
});

// ── Borrar ─────────────────────────────────────────────────────────────────────────────────
describe("DELETE /api/goals/[id] — quién borra qué (#895)", () => {
  it.each(["admin", "director"])("%s: puede borrar una meta de la empresa", async (quien) => {
    expect(await quitar(quien, "g-empresa")).toBe(200);
  });

  it("gerente y líder NO borran metas de la empresa", async () => {
    expect(await quitar("gerente", "g-empresa")).toBe(403);
    expect(await quitar("lider", "g-empresa")).toBe(403);
    expect(goalUpdate).not.toHaveBeenCalled();
  });

  it("líder: borra la de alguien de su equipo; la de otro equipo no existe para él", async () => {
    expect(await quitar("lider", "g-ase-2")).toBe(200);
    goalUpdate.mockClear();
    expect(await quitar("lider", "g-ase-9")).toBe(404);
    expect(await quitar("lider", "g-team-9")).toBe(404);
    expect(goalUpdate).not.toHaveBeenCalled();
  });

  it("gerente: la de otra plaza no existe para él", async () => {
    expect(await quitar("gerente", "g-ase-9")).toBe(404);
    expect(goalUpdate).not.toHaveBeenCalled();
  });

  it("asesor: no borra ni la suya", async () => {
    expect(await quitar("asesor", "g-ase-1")).toBe(403);
    expect(goalUpdate).not.toHaveBeenCalled();
  });
});

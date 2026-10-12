import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const convFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { conversation: { findMany: (...a: unknown[]) => convFindMany(...a) } },
}));

// Marcas (2026-10-12): por defecto el usuario ve todas, así las pruebas de arriba siguen
// midiendo solo el alcance por rol. Las de marca (al final) cambian el valor.
const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { GET } from "./route";

function req(qs = "") {
  return { nextUrl: new URL(`http://x/api/conversations${qs}`) } as never;
}

beforeEach(() => {
  [getServerSession, convFindMany, getVisibleBrands].forEach((m) => m.mockReset());
  convFindMany.mockResolvedValue([]);
  getVisibleBrands.mockResolvedValue("ALL");
});

const ASESOR = { user: { id: "ase-1", role: "ASESOR_SR" } };
const GERENTE = { user: { id: "boss-1", role: "GERENTE" } };

function whereUsed() {
  return convFindMany.mock.calls[0][0].where;
}

describe("GET /api/conversations — aislamiento", () => {
  it("asesor sin search: scope suyos + sin asignar", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req());
    expect(whereUsed().contact).toEqual({
      AND: [{ OR: [{ assignedToId: "ase-1" }, { assignedToId: null }] }],
    });
  });

  it("REGRESIÓN fuga: asesor CON search conserva el scope (AND de ambos OR)", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req("?q=ana"));
    const contact = whereUsed().contact;
    expect(contact.AND).toHaveLength(2);
    expect(contact.AND[0]).toEqual({ OR: [{ assignedToId: "ase-1" }, { assignedToId: null }] });
    expect(contact.AND[1].OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ firstName: expect.anything() }),
        expect.objectContaining({ phone: expect.anything() }),
      ])
    );
  });

  it("gerente con search: solo la condición de búsqueda, sin scope", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    await GET(req("?q=ana"));
    expect(whereUsed().contact.AND).toHaveLength(1);
  });

  it("gerente sin filtros: contact queda undefined", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    await GET(req());
    expect(whereUsed().contact).toBeUndefined();
  });

  // TEAM_LEADER sigue SIN vista completa, pero su scope suma a su equipo: si no lo
  // tuviera, repartir la cola sería un viaje sin retorno (asigna → pierde el hilo).
  it("TEAM_LEADER NO tiene vista completa: lleva scope con su equipo", async () => {
    getServerSession.mockResolvedValue({ user: { id: "tl-1", role: "TEAM_LEADER" } });
    await GET(req());
    expect(whereUsed().contact.AND[0]).toEqual({
      OR: [
        { assignedToId: "tl-1" },
        { assignedToId: null },
        { assignedTo: { is: { teamLeaderId: "tl-1" } } },
      ],
    });
  });

  it("el término de equipo es SOLO del TEAM_LEADER: un asesor no lo lleva", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req());
    expect(JSON.stringify(whereUsed().contact)).not.toContain("teamLeaderId");
  });

  it("filtro mine compone con el scope del asesor", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req("?filter=mine"));
    expect(whereUsed().contact.AND).toEqual(
      expect.arrayContaining([{ assignedToId: "ase-1" }])
    );
  });

  it("filtro unassigned + search componen (3 condiciones para asesor)", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req("?filter=unassigned&q=ana"));
    expect(whereUsed().contact.AND).toHaveLength(3);
  });

  it("401 sin sesión", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(convFindMany).not.toHaveBeenCalled();
  });

  it("los filtros de estado (bot/human/unread) NO tocan where.contact", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    await GET(req("?filter=bot"));
    expect(whereUsed().status).toBe("BOT");
    expect(whereUsed().contact).toBeUndefined();
  });
});

// ── Marcas (entrega 2, 2026-10-12) ──────────────────────────────────────────────────────
// Evaluador manual del where.contact sobre un contacto en memoria (AND/OR/assignedToId/marcas).
// Lo que no reconoce LANZA, para que una forma nueva no se apruebe sin mirar.
type Fila = { assignedToId: string | null; brands: { brandId: string }[] };
function evalContacto(where: unknown, fila: Fila): boolean {
  if (where === undefined) return true;
  const w = where as Record<string, unknown>;
  if (Array.isArray(w.AND)) return (w.AND as unknown[]).every((x) => evalContacto(x, fila));
  if (Array.isArray(w.OR)) return (w.OR as unknown[]).some((x) => evalContacto(x, fila));
  if ("assignedToId" in w) return fila.assignedToId === w.assignedToId;
  if ("brands" in w) {
    const b = w.brands as { some?: { brandId: { in: string[] } }; none?: object };
    if (b.some) return fila.brands.some((x) => b.some!.brandId.in.includes(x.brandId));
    if (b.none) return fila.brands.length === 0;
  }
  throw new Error(`término no soportado: ${JSON.stringify(where)}`);
}

const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };
const CON_YAXNAH = { brandIds: ["b-def", "b-yax"], includesDefault: true };
const YAX_LIBRE: Fila = { assignedToId: null, brands: [{ brandId: "b-yax" }] };
const PROPYTE_LIBRE: Fila = { assignedToId: null, brands: [] };

describe("GET /api/conversations — marcas (AND sobre el alcance por rol)", () => {
  it("pide las marcas del usuario de la sesión", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    await GET(req());
    expect(getVisibleBrands).toHaveBeenCalledWith(ASESOR.user);
  });

  it("asesor SIN Yaxnáh, cola sin asignar: el hilo libre de Yaxnáh NO sale; el de Propyte sí", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    await GET(req("?filter=unassigned"));
    const contact = whereUsed().contact;
    expect(evalContacto(contact, YAX_LIBRE)).toBe(false);
    expect(evalContacto(contact, PROPYTE_LIBRE)).toBe(true);
  });

  it("asesor CON Yaxnáh, cola sin asignar: el hilo libre de Yaxnáh sí sale", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    getVisibleBrands.mockResolvedValue(CON_YAXNAH);
    await GET(req("?filter=unassigned"));
    expect(evalContacto(whereUsed().contact, YAX_LIBRE)).toBe(true);
  });

  it("GERENTE (vista completa) también se recorta por marca: ya no es `undefined`", async () => {
    getServerSession.mockResolvedValue(GERENTE);
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    await GET(req());
    const contact = whereUsed().contact;
    expect(contact).toBeDefined();
    expect(evalContacto(contact, YAX_LIBRE)).toBe(false);
    expect(evalContacto(contact, { assignedToId: "otro", brands: [] })).toBe(true);
  });

  it("forma: el alcance por rol y la marca van en AND, y la búsqueda se suma sin pisarlos", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    await GET(req("?q=ana"));
    const and = whereUsed().contact.AND;
    expect(and).toHaveLength(2);
    expect(and[0]).toEqual({
      AND: [
        { OR: [{ assignedToId: "ase-1" }, { assignedToId: null }] },
        {
          OR: [
            { assignedToId: "ase-1" },
            { brands: { some: { brandId: { in: ["b-def"] } } } },
            { brands: { none: {} } },
          ],
        },
      ],
    });
    expect(and[1].OR).toEqual(expect.arrayContaining([expect.objectContaining({ firstName: expect.anything() })]));
  });

  it("la marca nunca amplía: un asesor CON Yaxnáh no ve el hilo de Yaxnáh de otro asesor", async () => {
    getServerSession.mockResolvedValue(ASESOR);
    getVisibleBrands.mockResolvedValue(CON_YAXNAH);
    await GET(req());
    expect(evalContacto(whereUsed().contact, { assignedToId: "otro", brands: [{ brandId: "b-yax" }] })).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// #908/#952: guardar (PUT) o borrar (DELETE) un contacto exige poder ABRIR su ficha. Antes las dos
// rutas solo comprobaban que el contacto existiera: un asesor podía cambiarle el teléfono o el
// dueño a un contacto ajeno mandando su id, un rol de solo lectura podía guardar o borrar, y nadie
// miraba la marca.
//
// Aquí la puerta NO se simula: corre `getContactAccessInfo` de verdad (rol + marca) sobre una
// base de mentira, para que la prueba falle si la ruta deja de llamarla o si cambia su regla.

type Contacto = { id: string; assignedToId: string | null; brands: { brandId: string }[] };

const PROPIO = "11111111-1111-4111-8111-111111111111"; // de Ana (asesora, equipo de Toño, plaza PDC)
const AJENO = "22222222-2222-4222-8222-222222222222"; // de Beto (asesor, sin líder, plaza MERIDA)
const SIN_DUENO = "33333333-3333-4333-8333-333333333333";
const OTRA_MARCA = "44444444-4444-4444-8444-444444444444"; // de Beto, marca Yaxnah
const NO_EXISTE = "55555555-5555-4555-8555-555555555555";

const CONTACTOS: Record<string, Contacto> = {
  [PROPIO]: { id: PROPIO, assignedToId: "ana", brands: [] },
  [AJENO]: { id: AJENO, assignedToId: "beto", brands: [] },
  [SIN_DUENO]: { id: SIN_DUENO, assignedToId: null, brands: [] },
  [OTRA_MARCA]: { id: OTRA_MARCA, assignedToId: "beto", brands: [{ brandId: "b-yax" }] },
};

const USUARIOS = [
  { id: "ana", plaza: "PDC", teamLeaderId: "tono" },
  { id: "tono", plaza: "PDC", teamLeaderId: null },
  { id: "beto", plaza: "MERIDA", teamLeaderId: null },
];

const contactFindFirst = vi.fn();
const contactUpdate = vi.fn();
const userFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: { findFirst: (...a: unknown[]) => contactFindFirst(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a), findUnique: vi.fn() },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

// Solo Propyte (marca por defecto); ADMIN ve todas.
const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

vi.mock("@/lib/metadata/core-fields", () => ({
  resolveCoreFieldAccess: async () => ({}),
  nonEditableKeys: () => new Set(),
}));

vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_opts: unknown, fn: (tx: unknown) => unknown) =>
    fn({ contact: { update: (...a: unknown[]) => contactUpdate(...a) } }),
}));

vi.mock("@/lib/notificaciones/avisar-asignacion", () => ({ avisarAsignacion: vi.fn() }));
vi.mock("@/lib/webhooks/dispatcher", () => ({ dispatchWebhook: vi.fn() }));

import { PUT, DELETE } from "./route";

const sesion = (id: string, role: string, plaza = "PDC") => ({ user: { id, role, plaza, name: id } });

function pedir(metodo: "PUT" | "DELETE", id: string) {
  return new Request(`https://x/api/contacts?id=${id}`, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: metodo === "PUT" ? JSON.stringify({ firstName: "Nombre Nuevo" }) : undefined,
  }) as unknown as import("next/server").NextRequest;
}

async function guardarComo(s: ReturnType<typeof sesion>, id: string) {
  getServerSession.mockResolvedValue(s);
  return PUT(pedir("PUT", id));
}

async function borrarComo(s: ReturnType<typeof sesion>, id: string) {
  getServerSession.mockResolvedValue(s);
  return DELETE(pedir("DELETE", id));
}

beforeEach(() => {
  for (const m of [contactFindFirst, contactUpdate, userFindMany, getServerSession, getVisibleBrands]) m.mockReset();

  contactFindFirst.mockImplementation(async (args: { where: { id?: string } }) => {
    const c = args.where.id ? CONTACTOS[args.where.id] : undefined;
    return c ? { ...c, phone: "+5219991112233", whatsappUserId: null, tags: [], campaignId: null } : null;
  });
  userFindMany.mockImplementation(async (args: { where: { plaza?: string; teamLeaderId?: string } }) =>
    USUARIOS.filter((u) =>
      args.where.teamLeaderId !== undefined ? u.teamLeaderId === args.where.teamLeaderId : u.plaza === args.where.plaza,
    ).map((u) => ({ id: u.id })),
  );
  getVisibleBrands.mockImplementation(async (u: { role: string }) =>
    u.role === "ADMIN" ? "ALL" : { brandIds: ["b-def"], includesDefault: true },
  );
  contactUpdate.mockImplementation(async (args: { where: { id: string } }) => ({
    id: args.where.id,
    firstName: "Nombre",
    lastName: "Nuevo",
    assignedToId: CONTACTOS[args.where.id]?.assignedToId ?? null,
  }));
});

describe("PUT /api/contacts — solo guarda quien puede abrir la ficha (#908)", () => {
  it("la asesora guarda su propio contacto: 200", async () => {
    const res = await guardarComo(sesion("ana", "ASESOR"), PROPIO);
    expect(res.status).toBe(200);
    expect(contactUpdate).toHaveBeenCalledTimes(1);
  });

  it("la asesora NO guarda el contacto de otro asesor: 403 y no escribe", async () => {
    const res = await guardarComo(sesion("ana", "ASESOR"), AJENO);
    expect(res.status).toBe(403);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("el líder guarda el contacto de alguien de su equipo: 200", async () => {
    const res = await guardarComo(sesion("tono", "TEAM_LEADER"), PROPIO);
    expect(res.status).toBe(200);
  });

  it("el líder NO guarda el contacto de alguien fuera de su equipo: 403", async () => {
    const res = await guardarComo(sesion("tono", "TEAM_LEADER"), AJENO);
    expect(res.status).toBe(403);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("el gerente guarda contactos de su plaza y los que no tienen dueño: 200", async () => {
    expect((await guardarComo(sesion("ger", "GERENTE", "PDC"), PROPIO)).status).toBe(200);
    expect((await guardarComo(sesion("ger", "GERENTE", "PDC"), SIN_DUENO)).status).toBe(200);
  });

  // OJO: el gerente con un contacto de OTRA plaza no se prueba aquí. La puerta común de la ficha
  // (`rbacPermiteContacto`) no restringe su alcance por plaza a propósito desde el #907, así que
  // hoy puede abrir esa ficha y, por lo tanto, guardarla. Cerrarlo cambia lo que el gerente puede
  // abrir y va en su propia tarjeta.

  it("dirección guarda cualquiera de sus marcas: 200", async () => {
    const res = await guardarComo(sesion("dir", "DIRECTOR"), AJENO);
    expect(res.status).toBe(200);
  });

  it("un contacto de una marca que no ve responde como si no existiera: 404", async () => {
    const res = await guardarComo(sesion("dir", "DIRECTOR"), OTRA_MARCA);
    expect(res.status).toBe(404);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("ADMIN guarda cualquier contacto, de cualquier marca: 200", async () => {
    expect((await guardarComo(sesion("adm", "ADMIN"), OTRA_MARCA)).status).toBe(200);
  });

  it.each(["MARKETING", "HOSTESS", "MANTENIMIENTO"])(
    "%s ve todos los contactos pero no puede guardar ninguno: 403",
    async (rol) => {
      const res = await guardarComo(sesion("x", rol), SIN_DUENO);
      expect(res.status).toBe(403);
      expect(contactUpdate).not.toHaveBeenCalled();
    },
  );

  it("un id que no existe: 404", async () => {
    const res = await guardarComo(sesion("adm", "ADMIN"), NO_EXISTE);
    expect(res.status).toBe(404);
    expect(contactUpdate).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/contacts — además del rol, el contacto tiene que estar a su alcance (#908)", () => {
  it("el gerente borra un contacto de su plaza: 200", async () => {
    const res = await borrarComo(sesion("ger", "GERENTE", "PDC"), PROPIO);
    expect(res.status).toBe(200);
    expect(contactUpdate).toHaveBeenCalledTimes(1);
  });

  it("el líder (rol que no borra) sigue sin poder borrar: 403", async () => {
    const res = await borrarComo(sesion("tono", "TEAM_LEADER"), PROPIO);
    expect(res.status).toBe(403);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("dirección NO borra un contacto de una marca que no ve: 404", async () => {
    const res = await borrarComo(sesion("dir", "DIRECTOR"), OTRA_MARCA);
    expect(res.status).toBe(404);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("MANTENIMIENTO (solo lectura) ya no borra: 403", async () => {
    const res = await borrarComo(sesion("x", "MANTENIMIENTO"), SIN_DUENO);
    expect(res.status).toBe(403);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("un asesor sigue sin poder borrar, ni su propio contacto: 403", async () => {
    const res = await borrarComo(sesion("ana", "ASESOR"), PROPIO);
    expect(res.status).toBe(403);
  });
});

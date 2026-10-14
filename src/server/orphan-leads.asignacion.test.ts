// Asignación masiva del panel de leads huérfanos (2026-10-14, #883). assignContact tiene sus propias
// pruebas (lib/inbox/assign.test.ts, incluido su modo panel); aquí se prueba el lote: quién puede, a
// quién, sobre qué contactos, el tope, las fallas por contacto y que avise UNA vez.
import { describe, it, expect, vi, beforeEach } from "vitest";

const userFindFirst = vi.fn();
const userFindMany = vi.fn();
const contactFindMany = vi.fn();
const notificationCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a), findMany: (...a: unknown[]) => userFindMany(...a) },
    contact: { findMany: (...a: unknown[]) => contactFindMany(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
  },
}));
const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));
const assignContact = vi.fn();
vi.mock("@/lib/inbox/assign", () => ({ assignContact: (...a: unknown[]) => assignContact(...a) }));

import {
  asignarHuerfanosEnLote,
  BULK_ASSIGN_NOTIFICATION_TYPE,
  getOrphanAssignees,
  MAX_ASIGNACION_POR_LOTE,
} from "./orphan-leads";

const LUIS = { id: "luis-1", role: "ADMIN" };
const MKT = { id: "mkt-1", role: "MARKETING" };
const PEDRO = { id: "ase-2", name: "Pedro Ruiz", email: "pedro@propyte.com", role: "ASESOR" };
const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };
const REGLA_PERSONA = { isActive: true, deletedAt: null, NOT: { email: { endsWith: ".local" } } };

/** UUIDs falsos pero con forma de id. */
const ids = (n: number) => Array.from({ length: n }, (_, i) => `c-${i + 1}`);

beforeEach(() => {
  vi.resetAllMocks();
  getVisibleBrands.mockResolvedValue("ALL");
  userFindFirst.mockResolvedValue(PEDRO);
  // Por defecto quien asigna ve todos los contactos que pide.
  contactFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => ({ id })),
  );
  assignContact.mockImplementation(async ({ assigneeId }: { assigneeId: string }) => ({
    ok: true,
    assignedTo: { id: assigneeId, name: "Pedro Ruiz" },
  }));
  notificationCreate.mockResolvedValue({});
});

describe("asignarHuerfanosEnLote — quién puede", () => {
  it.each(["ASESOR", "ASESOR_SR", "ASESOR_JR", "TEAM_LEADER", "HOSTESS", "BROKER", "DEVELOPER_EXT", "MANTENIMIENTO"])(
    "🚨 %s (no ve el panel) → sin-permiso sin tocar nada",
    async (role) => {
      const r = await asignarHuerfanosEnLote({ actor: { id: "x", role }, contactIds: ids(3), assigneeId: "ase-2" });
      expect(r).toEqual({ ok: false, code: "sin-permiso" });
      expect(userFindFirst).not.toHaveBeenCalled();
      expect(contactFindMany).not.toHaveBeenCalled();
      expect(assignContact).not.toHaveBeenCalled();
      expect(notificationCreate).not.toHaveBeenCalled();
    },
  );

  it.each(["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"])("%s (ve el panel) → asigna", async (role) => {
    const r = await asignarHuerfanosEnLote({ actor: { id: "a-1", role }, contactIds: ids(2), assigneeId: "ase-2" });
    expect(r.ok).toBe(true);
    expect(assignContact).toHaveBeenCalledTimes(2);
  });
});

describe("asignarHuerfanosEnLote — a quién", () => {
  it("valida al destino UNA vez con la regla única de ruteables, antes de tocar ningún contacto", async () => {
    await asignarHuerfanosEnLote({ actor: LUIS, contactIds: ids(3), assigneeId: "ase-2" });
    expect(userFindFirst).toHaveBeenCalledTimes(1);
    expect(userFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ase-2", ...REGLA_PERSONA } }));
  });

  it.each([
    ["inexistente, inactivo o borrado", null],
    ["cuenta técnica (.local)", { ...PEDRO, email: "agentes@propyte.local" }],
    ["rol que no atiende leads (HOSTESS)", { ...PEDRO, role: "HOSTESS" }],
    ["rol que no atiende leads (MARKETING)", { ...PEDRO, role: "MARKETING" }],
  ])("🚨 destino %s → usuario-invalido y no se asigna nada", async (_caso, user) => {
    userFindFirst.mockResolvedValue(user);
    const r = await asignarHuerfanosEnLote({ actor: LUIS, contactIds: ids(3), assigneeId: "ase-2" });
    expect(r).toEqual({ ok: false, code: "usuario-invalido" });
    expect(assignContact).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});

describe("asignarHuerfanosEnLote — tope y forma del lote", () => {
  it(`más de ${MAX_ASIGNACION_POR_LOTE} contactos distintos → demasiados, sin tocar nada`, async () => {
    const r = await asignarHuerfanosEnLote({ actor: LUIS, contactIds: ids(MAX_ASIGNACION_POR_LOTE + 1), assigneeId: "ase-2" });
    expect(r).toEqual({ ok: false, code: "demasiados" });
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(assignContact).not.toHaveBeenCalled();
  });

  it("justo el tope pasa; los repetidos cuentan una vez", async () => {
    const lista = [...ids(MAX_ASIGNACION_POR_LOTE), "c-1", "c-2"];
    const r = await asignarHuerfanosEnLote({ actor: LUIS, contactIds: lista, assigneeId: "ase-2" });
    expect(r).toEqual(expect.objectContaining({ ok: true, asignados: MAX_ASIGNACION_POR_LOTE }));
    expect(assignContact).toHaveBeenCalledTimes(MAX_ASIGNACION_POR_LOTE);
  });

  it("sin contactos → vacio", async () => {
    expect(await asignarHuerfanosEnLote({ actor: LUIS, contactIds: [], assigneeId: "ase-2" })).toEqual({
      ok: false,
      code: "vacio",
    });
  });
});

describe("asignarHuerfanosEnLote — sobre qué contactos", () => {
  it("cada contacto va por assignContact en modo panel, con quien asigna como actor y el origen del lote", async () => {
    await asignarHuerfanosEnLote({ actor: MKT, contactIds: ["c-1"], assigneeId: "ase-2" });
    expect(assignContact).toHaveBeenCalledWith({
      contactId: "c-1",
      assigneeId: "ase-2",
      actor: MKT,
      source: "orphan_bulk_assign",
      panelHuerfanos: true,
    });
  });

  it("🚨 solo los que quien asigna ve por marca: el resto da no-existe y ni se intenta", async () => {
    getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
    contactFindMany.mockResolvedValue([{ id: "c-1" }]);
    const r = await asignarHuerfanosEnLote({ actor: MKT, contactIds: ["c-1", "c-otra-marca"], assigneeId: "ase-2" });

    const where = contactFindMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ in: ["c-1", "c-otra-marca"] });
    expect(where.deletedAt).toBeNull();
    expect(where.mergedIntoId).toBeNull();
    expect(where.AND).toEqual([
      { OR: [{ assignedToId: "mkt-1" }, { brands: { some: { brandId: { in: ["b-def"] } } } }, { brands: { none: {} } }] },
    ]);
    expect(assignContact).toHaveBeenCalledTimes(1);
    expect(r).toEqual(expect.objectContaining({ asignados: 1, fallidos: [{ contactId: "c-otra-marca", code: "no-existe" }] }));
  });

  it("ADMIN (ve todas las marcas): sin recorte", async () => {
    await asignarHuerfanosEnLote({ actor: LUIS, contactIds: ["c-1"], assigneeId: "ase-2" });
    expect(contactFindMany.mock.calls[0][0].where.AND).toBeUndefined();
  });

  it("las fallas por contacto se reportan y el resto sigue (incluida una excepción)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    assignContact.mockImplementation(async ({ contactId }: { contactId: string }) => {
      if (contactId === "c-2") return { ok: false, code: "ya-asignado" };
      if (contactId === "c-3") throw new Error("BD caída");
      if (contactId === "c-4") return { ok: false, code: "conflicto" };
      return { ok: true, assignedTo: { id: "ase-2", name: "Pedro Ruiz" } };
    });
    const r = await asignarHuerfanosEnLote({ actor: LUIS, contactIds: ids(6), assigneeId: "ase-2" });
    expect(r).toEqual({
      ok: true,
      asignados: 3,
      yaEranSuyos: 0,
      fallidos: [
        { contactId: "c-2", code: "ya-asignado" },
        { contactId: "c-3", code: "error" },
        { contactId: "c-4", code: "conflicto" },
      ],
      assignee: { id: "ase-2", name: "Pedro Ruiz" },
    });
    expect(assignContact).toHaveBeenCalledTimes(6);
    error.mockRestore();
  });
});

describe("asignarHuerfanosEnLote — un solo aviso por lote", () => {
  it("🚨 110 asignados → UN aviso al asignado con el total, no 110", async () => {
    const r = await asignarHuerfanosEnLote({ actor: LUIS, contactIds: ids(110), assigneeId: "ase-2" });
    expect(r).toEqual(expect.objectContaining({ ok: true, asignados: 110 }));
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(notificationCreate).toHaveBeenCalledWith({
      data: {
        userId: "ase-2",
        type: BULK_ASSIGN_NOTIFICATION_TYPE,
        title: "Prospectos asignados",
        message: "Se te asignaron 110 prospectos desde Leads huérfanos",
        link: "/contacts",
      },
    });
  });

  it("uno solo → en singular", async () => {
    await asignarHuerfanosEnLote({ actor: LUIS, contactIds: ["c-1"], assigneeId: "ase-2" });
    expect(notificationCreate.mock.calls[0][0].data.message).toBe("Se te asignó 1 prospecto desde Leads huérfanos");
  });

  it("el aviso cuenta solo lo que cambió (no los que ya eran suyos ni los que fallaron)", async () => {
    assignContact.mockImplementation(async ({ contactId }: { contactId: string }) =>
      contactId === "c-1"
        ? { ok: true, assignedTo: { id: "ase-2", name: "Pedro Ruiz" }, sinCambio: true }
        : contactId === "c-2"
          ? { ok: false, code: "ya-asignado" }
          : { ok: true, assignedTo: { id: "ase-2", name: "Pedro Ruiz" } },
    );
    const r = await asignarHuerfanosEnLote({ actor: LUIS, contactIds: ids(4), assigneeId: "ase-2" });
    expect(r).toEqual(expect.objectContaining({ asignados: 2, yaEranSuyos: 1 }));
    expect(notificationCreate.mock.calls[0][0].data.message).toBe("Se te asignaron 2 prospectos desde Leads huérfanos");
  });

  it("repetir el lote (todos ya eran suyos) → nada asignado y ningún aviso", async () => {
    assignContact.mockResolvedValue({ ok: true, assignedTo: { id: "ase-2", name: "Pedro Ruiz" }, sinCambio: true });
    const r = await asignarHuerfanosEnLote({ actor: LUIS, contactIds: ids(5), assigneeId: "ase-2" });
    expect(r).toEqual(expect.objectContaining({ asignados: 0, yaEranSuyos: 5, fallidos: [] }));
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("asignarse a uno mismo no se avisa", async () => {
    userFindFirst.mockResolvedValue({ id: "luis-1", name: "Luis Flores", email: "luis@nativatulum.mx", role: "ADMIN" });
    const r = await asignarHuerfanosEnLote({ actor: LUIS, contactIds: ids(3), assigneeId: "luis-1" });
    expect(r).toEqual(expect.objectContaining({ asignados: 3 }));
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("si el aviso falla, las asignaciones ya quedaron y el lote responde ok", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    notificationCreate.mockRejectedValue(new Error("boom"));
    const r = await asignarHuerfanosEnLote({ actor: LUIS, contactIds: ids(2), assigneeId: "ase-2" });
    expect(r).toEqual(expect.objectContaining({ ok: true, asignados: 2 }));
    error.mockRestore();
  });
});

describe("getOrphanAssignees", () => {
  it("solo personas (regla única de ruteables) con un rol que puede ser dueño de un contacto", async () => {
    userFindMany.mockResolvedValue([]);
    await getOrphanAssignees();
    const arg = userFindMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      ...REGLA_PERSONA,
      role: { in: ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER", "ASESOR", "ASESOR_SR", "ASESOR_JR"] },
    });
    expect(arg.select).toEqual({ id: true, name: true });
  });
});

// src/lib/inbox/assign.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindFirst = vi.fn();
const userFindFirst = vi.fn();
const activityCreate = vi.fn();
const notificationCreate = vi.fn();
const txContactUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findFirst: (...a: unknown[]) => contactFindFirst(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
  },
}));

// withChangeSource: capturamos opts y corremos fn con un tx falso que expone contact.update
const changeSourceCalls: unknown[] = [];
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: async (opts: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    changeSourceCalls.push(opts);
    return fn({ contact: { update: (...a: unknown[]) => txContactUpdate(...a) } });
  },
}));

import { assignContact } from "./assign";

const MANDO = { id: "boss-1", role: "GERENTE" } as const;
const ASESOR = { id: "ase-1", role: "ASESOR_SR" } as const;
const CONTACTO_LIBRE = {
  id: "c1", assignedToId: null, updatedAt: new Date("2026-08-06T00:00:00Z"),
  firstName: "Ana", lastName: "López",
};
const USUARIO_OK = { id: "ase-2", name: "Pedro Ruiz", email: "pedro@propyte.com" };

beforeEach(() => {
  [contactFindFirst, userFindFirst, activityCreate, notificationCreate, txContactUpdate]
    .forEach((m) => m.mockReset());
  changeSourceCalls.length = 0;
  contactFindFirst.mockResolvedValue(CONTACTO_LIBRE);
  userFindFirst.mockResolvedValue(USUARIO_OK);
  txContactUpdate.mockResolvedValue({});
  activityCreate.mockResolvedValue({});
  notificationCreate.mockResolvedValue({});
});

describe("assignContact — permisos", () => {
  it("mando asigna a un usuario válido: update + Notification + Activity", async () => {
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO, conversationId: "conv-1" });
    expect(r).toEqual({ ok: true, assignedTo: { id: "ase-2", name: "Pedro Ruiz" } });
    expect(txContactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1", updatedAt: CONTACTO_LIBRE.updatedAt }, // lock optimista
        data: { assignedToId: "ase-2" },
      })
    );
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "ase-2",
          type: "conversation_assigned",
          link: "/inbox?focus=conv-1",
        }),
      })
    );
    expect(activityCreate).toHaveBeenCalled();
  });

  it("mando reasigna un contacto que ya tenía dueño", async () => {
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: "otro" });
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(r.ok).toBe(true);
  });

  it("mando quita la asignación (null): sin Notification", async () => {
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: "otro" });
    const r = await assignContact({ contactId: "c1", assigneeId: null, actor: MANDO });
    expect(r).toEqual({ ok: true, assignedTo: null });
    expect(txContactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { assignedToId: null } })
    );
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(userFindFirst).not.toHaveBeenCalled(); // no valida usuario al desasignar
  });

  it("asesor reclama contacto libre: ok y SIN Notification (es para sí mismo)", async () => {
    userFindFirst.mockResolvedValue({ id: "ase-1", name: "Luisa", email: "l@propyte.com" });
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-1", actor: ASESOR });
    expect(r.ok).toBe(true);
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("asesor reclama contacto ya asignado a OTRO → ya-asignado, sin update", async () => {
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: "otro" });
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-1", actor: ASESOR });
    expect(r).toEqual({ ok: false, code: "ya-asignado" });
    expect(txContactUpdate).not.toHaveBeenCalled();
  });

  it("asesor reclama un contacto que YA es suyo → ok idempotente sin escribir", async () => {
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: "ase-1" });
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-1", actor: ASESOR });
    expect(r.ok).toBe(true);
    expect(txContactUpdate).not.toHaveBeenCalled();
  });

  it("asesor intenta asignar a un tercero → sin-permiso", async () => {
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: ASESOR });
    expect(r).toEqual({ ok: false, code: "sin-permiso" });
  });

  it("asesor intenta desasignar → sin-permiso", async () => {
    const r = await assignContact({ contactId: "c1", assigneeId: null, actor: ASESOR });
    expect(r).toEqual({ ok: false, code: "sin-permiso" });
  });
});

describe("assignContact — validación del asignado", () => {
  it("usuario inexistente o inactivo → usuario-invalido", async () => {
    userFindFirst.mockResolvedValue(null);
    const r = await assignContact({ contactId: "c1", assigneeId: "nadie", actor: MANDO });
    expect(r).toEqual({ ok: false, code: "usuario-invalido" });
  });

  it("usuario con email .local (QA) → usuario-invalido, también a mano (espíritu AUD-09)", async () => {
    userFindFirst.mockResolvedValue({ id: "qa-1", name: "QA", email: "qa-asesor@propyte.local" });
    const r = await assignContact({ contactId: "c1", assigneeId: "qa-1", actor: MANDO });
    expect(r).toEqual({ ok: false, code: "usuario-invalido" });
  });
});

describe("assignContact — contacto y concurrencia", () => {
  it("contacto inexistente o borrado → no-existe (el findFirst filtra deletedAt)", async () => {
    contactFindFirst.mockResolvedValue(null);
    const r = await assignContact({ contactId: "cX", assigneeId: "ase-2", actor: MANDO });
    expect(r).toEqual({ ok: false, code: "no-existe" });
    expect(contactFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) })
    );
  });

  it("update falla por lock optimista → conflicto", async () => {
    txContactUpdate.mockRejectedValue(new Error("P2025"));
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(r).toEqual({ ok: false, code: "conflicto" });
  });
});

describe("assignContact — cronología y side-effects", () => {
  it("usa source inbox_assign por default y el override inbox_autoclaim", async () => {
    await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(changeSourceCalls[0]).toEqual({ source: "inbox_assign", actorId: "boss-1" });

    userFindFirst.mockResolvedValue({ id: "ase-1", name: "Luisa", email: "l@propyte.com" });
    await assignContact({
      contactId: "c1", assigneeId: "ase-1",
      actor: ASESOR, source: "inbox_autoclaim",
    });
    expect(changeSourceCalls[1]).toEqual({ source: "inbox_autoclaim", actorId: "ase-1" });
  });

  it("si Notification o Activity revientan, la operación sigue siendo ok", async () => {
    notificationCreate.mockRejectedValue(new Error("boom"));
    activityCreate.mockRejectedValue(new Error("boom"));
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(r.ok).toBe(true);
  });
});

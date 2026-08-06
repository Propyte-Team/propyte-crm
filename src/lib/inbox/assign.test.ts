// src/lib/inbox/assign.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindFirst = vi.fn();
const userFindFirst = vi.fn();
const activityCreate = vi.fn();
const notificationCreate = vi.fn();
const txContactUpdate = vi.fn();
const txConversationUpdateMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findFirst: (...a: unknown[]) => contactFindFirst(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
  },
}));

// withChangeSource: capturamos opts y corremos fn con un tx falso que expone
// contact.update y conversation.updateMany (FIX 1: liberar control va en la misma tx).
const changeSourceCalls: unknown[] = [];
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: async (opts: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    changeSourceCalls.push(opts);
    return fn({
      contact: { update: (...a: unknown[]) => txContactUpdate(...a) },
      conversation: { updateMany: (...a: unknown[]) => txConversationUpdateMany(...a) },
    });
  },
}));

import { UserRole } from "@prisma/client";
import { assignContact } from "./assign";
import { canOwnInboxContact } from "./roles";

const MANDO = { id: "boss-1", role: "GERENTE" } as const;
const ASESOR = { id: "ase-1", role: "ASESOR_SR" } as const;
const CONTACTO_LIBRE = {
  id: "c1", assignedToId: null, updatedAt: new Date("2026-08-06T00:00:00Z"),
  firstName: "Ana", lastName: "López",
};
const USUARIO_OK = { id: "ase-2", name: "Pedro Ruiz", email: "pedro@propyte.com", role: "ASESOR" };

beforeEach(() => {
  [
    contactFindFirst, userFindFirst, activityCreate, notificationCreate,
    txContactUpdate, txConversationUpdateMany,
  ].forEach((m) => m.mockReset());
  changeSourceCalls.length = 0;
  contactFindFirst.mockResolvedValue(CONTACTO_LIBRE);
  userFindFirst.mockResolvedValue(USUARIO_OK);
  txContactUpdate.mockResolvedValue({});
  txConversationUpdateMany.mockResolvedValue({ count: 0 });
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
          // inbox-view.tsx lee useSearchParams().get("c"), no "focus" (FIX 2).
          link: "/inbox?c=conv-1",
        }),
      })
    );
    expect(activityCreate).toHaveBeenCalled();
    expect(activityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subject: "Asignó la conversación a Pedro Ruiz" }),
      })
    );
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
    expect(activityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subject: "Quitó la asignación de la conversación" }),
      })
    );
  });

  it("mando reasigna al MISMO dueño actual → ok idempotente, sin update ni Notification", async () => {
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: "ase-2" });
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(r).toEqual({ ok: true, assignedTo: { id: "ase-2", name: "Pedro Ruiz" } });
    expect(txContactUpdate).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it("mando desasigna un contacto que YA estaba libre → ok idempotente, sin update ni Activity", async () => {
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: null });
    const r = await assignContact({ contactId: "c1", assigneeId: null, actor: MANDO });
    expect(r).toEqual({ ok: true, assignedTo: null });
    expect(txContactUpdate).not.toHaveBeenCalled();
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it("el guard de idempotencia va DESPUÉS de permisos: asesor manda el id de un tercero que YA lo posee → sin-permiso", async () => {
    // Fija el ORDEN, no solo el resultado: si el guard de idempotencia (assignedToId===assigneeId)
    // se evaluara ANTES del bloque de permisos, este caso calzaría con "ya es el dueño actual" y
    // devolvería {ok:true, assignedTo:{id:"ase-2",...}} — éxito indebido que filtra el nombre de
    // un tercero a un asesor sin permiso real para tocar esa asignación.
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: "ase-2" });
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: ASESOR });
    expect(r).toEqual({ ok: false, code: "sin-permiso" });
    expect(txContactUpdate).not.toHaveBeenCalled();
  });

  it("asesor reclama contacto libre: ok y SIN Notification (es para sí mismo)", async () => {
    userFindFirst.mockResolvedValue({ id: "ase-1", name: "Luisa", email: "l@propyte.com", role: "ASESOR_SR" });
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-1", actor: ASESOR });
    expect(r.ok).toBe(true);
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(activityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subject: "Reclamó la conversación" }),
      })
    );
  });

  it("asesor reclama contacto ya asignado a OTRO → ya-asignado, sin update", async () => {
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: "otro" });
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-1", actor: ASESOR });
    expect(r).toEqual({ ok: false, code: "ya-asignado" });
    expect(txContactUpdate).not.toHaveBeenCalled();
  });

  it("asesor reclama un contacto que YA es suyo → ok idempotente sin escribir, con nombre real", async () => {
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: "ase-1" });
    userFindFirst.mockResolvedValue({ id: "ase-1", name: "Luisa", email: "l@propyte.com", role: "ASESOR_SR" });
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-1", actor: ASESOR });
    expect(r).toEqual({ ok: true, assignedTo: { id: "ase-1", name: "Luisa" } });
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

  it("rol sin claim (MARKETING) no puede reclamar aunque mande su propio id — el gate genérico de la ruta ya no lo detiene", async () => {
    const MARKETING = { id: "mkt-1", role: "MARKETING" } as const;
    const r = await assignContact({ contactId: "c1", assigneeId: "mkt-1", actor: MARKETING });
    expect(r).toEqual({ ok: false, code: "sin-permiso" });
    expect(txContactUpdate).not.toHaveBeenCalled();
  });

  it("ASESOR_JR sí puede reclamar un contacto libre", async () => {
    const JR = { id: "jr-1", role: "ASESOR_JR" } as const;
    userFindFirst.mockResolvedValue({ id: "jr-1", name: "Junior", email: "jr@propyte.com", role: "ASESOR_JR" });
    const r = await assignContact({ contactId: "c1", assigneeId: "jr-1", actor: JR });
    expect(r.ok).toBe(true);
    expect(txContactUpdate).toHaveBeenCalled();
  });

  it("anti-clase: cada rol del enum UserRole o puede ser dueño (claim ok) o recibe sin-permiso — ninguno queda en limbo", async () => {
    for (const role of Object.values(UserRole)) {
      contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: null });
      userFindFirst.mockResolvedValue({ id: "u-1", name: "Quien sea", email: "quien@propyte.com", role });
      const r = await assignContact({ contactId: "c1", assigneeId: "u-1", actor: { id: "u-1", role } });
      if (canOwnInboxContact(role)) {
        expect(r.ok, `rol ${role} debería poder reclamar`).toBe(true);
      } else {
        expect(r, `rol ${role} debería quedar sin-permiso, no en limbo`).toEqual({ ok: false, code: "sin-permiso" });
      }
    }
  });
});

describe("assignContact — validación del asignado", () => {
  it("usuario inexistente o inactivo → usuario-invalido", async () => {
    userFindFirst.mockResolvedValue(null);
    const r = await assignContact({ contactId: "c1", assigneeId: "nadie", actor: MANDO });
    expect(r).toEqual({ ok: false, code: "usuario-invalido" });
    expect(txContactUpdate).not.toHaveBeenCalled();
  });

  it("usuario con email .local (QA) → usuario-invalido, también a mano (espíritu AUD-09)", async () => {
    userFindFirst.mockResolvedValue({ id: "qa-1", name: "QA", email: "qa-asesor@propyte.local" });
    const r = await assignContact({ contactId: "c1", assigneeId: "qa-1", actor: MANDO });
    expect(r).toEqual({ ok: false, code: "usuario-invalido" });
    expect(txContactUpdate).not.toHaveBeenCalled();
  });

  it("mando asigna a un usuario cuyo ROL no puede ser dueño (HOSTESS) → usuario-invalido", async () => {
    userFindFirst.mockResolvedValue({ id: "host-1", name: "Hostess", email: "host@propyte.com", role: "HOSTESS" });
    const r = await assignContact({ contactId: "c1", assigneeId: "host-1", actor: MANDO });
    expect(r).toEqual({ ok: false, code: "usuario-invalido" });
    expect(txContactUpdate).not.toHaveBeenCalled();
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

  it("update falla por lock optimista (P2025) → conflicto", async () => {
    txContactUpdate.mockRejectedValue(Object.assign(new Error("Record not found"), { code: "P2025" }));
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(r).toEqual({ ok: false, code: "conflicto" });
  });

  it("update falla por otra razón (BD caída, sin code P2025) → propaga el error, NO conflicto", async () => {
    txContactUpdate.mockRejectedValue(new Error("connection refused"));
    await expect(
      assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO })
    ).rejects.toThrow("connection refused");
  });
});

describe("assignContact — cronología y side-effects", () => {
  it("usa source inbox_assign por default y el override inbox_autoclaim", async () => {
    await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(changeSourceCalls[0]).toEqual({ source: "inbox_assign", actorId: "boss-1" });

    userFindFirst.mockResolvedValue({ id: "ase-1", name: "Luisa", email: "l@propyte.com", role: "ASESOR_SR" });
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

  it("Activity revienta pero Notification SÍ se crea (son try/catch independientes)", async () => {
    activityCreate.mockRejectedValue(new Error("boom"));
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(r.ok).toBe(true);
    expect(notificationCreate).toHaveBeenCalled();
  });
});

describe("assignContact — libera el control al reasignar (FIX 1)", () => {
  it("al reasignar, libera el control con el filtro correcto y DENTRO de la transacción", async () => {
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(r.ok).toBe(true);
    // Solo existe porque el mock de withChangeSource ejecuta fn(tx) y expone
    // conversation.updateMany en ESE tx falso — si assign.ts lo llamara fuera de la
    // transacción (p.ej. contra prisma directo), este mock nunca vería la llamada.
    expect(txConversationUpdateMany).toHaveBeenCalledWith({
      where: { contactId: "c1", controlledById: { not: "ase-2" } },
      data: { controlledById: null },
    });
  });

  it("camino idempotente (mismo dueño): no toca el control", async () => {
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: "ase-2" });
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(r.ok).toBe(true);
    expect(txContactUpdate).not.toHaveBeenCalled();
    expect(txConversationUpdateMany).not.toHaveBeenCalled();
  });

  it("si el nuevo dueño ya era el controlador, el filtro lo excluye (no se le quita el control)", async () => {
    // El propio filtro "controlledById: { not: assigneeId }" es la garantía: cualquier
    // hilo donde controlledById YA es el nuevo dueño no matchea el where y queda intacto.
    const r = await assignContact({ contactId: "c1", assigneeId: "ase-2", actor: MANDO });
    expect(r.ok).toBe(true);
    const [{ where }] = txConversationUpdateMany.mock.calls[0];
    expect(where).toEqual({ contactId: "c1", controlledById: { not: "ase-2" } });
  });

  it("también libera el control al quitar la asignación (assigneeId null)", async () => {
    contactFindFirst.mockResolvedValue({ ...CONTACTO_LIBRE, assignedToId: "otro" });
    const r = await assignContact({ contactId: "c1", assigneeId: null, actor: MANDO });
    expect(r.ok).toBe(true);
    expect(txConversationUpdateMany).toHaveBeenCalledWith({
      where: { contactId: "c1", controlledById: { not: null } },
      data: { controlledById: null },
    });
  });
});

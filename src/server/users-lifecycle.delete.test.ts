import { describe, it, expect, vi, beforeEach } from "vitest";

// Nota: agrupados en vi.hoisted() porque vi.mock("@/lib/db", factory) se
// hoistea por encima de TODO el código top-level del archivo (incluyendo un
// `const db = {...}` normal). Sin esto, la factory intenta leer `db` antes
// de que exista -> "Cannot access 'db' before initialization". Los vi.fn()
// sueltos sí se hoistean solos; el objeto que los envuelve, no.
const {
  userUpdate,
  userFindUnique,
  userCount,
  userFindMany,
  teamFindMany,
  territoryMemberCount,
  contactUpdateMany,
  contactCount,
  auditCreate,
  db,
} = vi.hoisted(() => {
  const userUpdate = vi.fn();
  const userFindUnique = vi.fn();
  const userCount = vi.fn();
  const userFindMany = vi.fn();
  const teamFindMany = vi.fn();
  const territoryMemberCount = vi.fn();
  const contactUpdateMany = vi.fn();
  const contactCount = vi.fn();
  const auditCreate = vi.fn();

  // Los 5 scopes que estos tests no ejercitan devuelven 0 fijo: lo que se
  // prueba aquí es la baja, no el conteo de activos. `contactCount` sí es
  // configurable, porque es el que dispara el guard de cartera viva.
  const emptyScope = { count: async () => 0, updateMany: async () => ({ count: 0 }) };

  const db = {
    user: {
      update: (...a: unknown[]) => userUpdate(...a),
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      count: (...a: unknown[]) => userCount(...a),
      findMany: (...a: unknown[]) => userFindMany(...a),
    },
    contact: {
      updateMany: (...a: unknown[]) => contactUpdateMany(...a),
      count: (...a: unknown[]) => contactCount(...a),
    },
    deal: emptyScope,
    conversation: emptyScope,
    unit: emptyScope,
    walkIn: emptyScope,
    quote: emptyScope,
    team: { findMany: (...a: unknown[]) => teamFindMany(...a) },
    territoryMember: { count: (...a: unknown[]) => territoryMemberCount(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  };

  return {
    userUpdate,
    userFindUnique,
    userCount,
    userFindMany,
    teamFindMany,
    territoryMemberCount,
    contactUpdateMany,
    contactCount,
    auditCreate,
    db,
  };
});

vi.mock("@/lib/db", () => ({
  default: { ...db, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db) },
}));

const session = { user: { id: "actor-1", role: "DIRECTOR" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => session }));

import { softDeleteUser, restoreUser } from "./users-lifecycle";

beforeEach(() => {
  for (const m of [
    userUpdate, userFindUnique, userCount, userFindMany,
    teamFindMany, territoryMemberCount, contactUpdateMany, contactCount, auditCreate,
  ]) m.mockReset();

  // Por defecto el usuario no tiene cartera viva: así los tests de la baja
  // prueban la baja, y el guard de activos se ejercita en sus propios casos.
  contactCount.mockResolvedValue(0);

  userFindUnique.mockResolvedValue({
    id: "u1", name: "Ana", role: "ASESOR_JR", isActive: true, deletedAt: null,
  });
  userCount.mockResolvedValue(3);
  userFindMany.mockResolvedValue([]);
  teamFindMany.mockResolvedValue([]);
  territoryMemberCount.mockResolvedValue(0);
  contactUpdateMany.mockResolvedValue({ count: 5 });
  userUpdate.mockResolvedValue({ id: "u1", name: "Ana" });
  auditCreate.mockResolvedValue({});
  session.user = { id: "actor-1", role: "DIRECTOR" };
});

describe("softDeleteUser", () => {
  it("escribe deletedAt, isActive=false y status=INACTIVE de una vez", async () => {
    await softDeleteUser("u1");

    const { data } = userUpdate.mock.calls[0][0];
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.isActive).toBe(false);
    expect(data.status).toBe("INACTIVE");
  });

  it("se niega a eliminar a quien todavía tiene cartera asignada", async () => {
    contactCount.mockResolvedValue(12);

    await expect(softDeleteUser("u1")).rejects.toThrow(/12 Contactos/);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("sí elimina cuando la reasignación en el mismo paso vació la cartera", async () => {
    // Antes de mover hay 12; el updateMany se los lleva y el guard, que corre
    // después, ya no ve nada.
    contactCount.mockResolvedValue(0);
    contactUpdateMany.mockResolvedValue({ count: 12 });

    const result = await softDeleteUser("u1", { reassignTo: "u2", scopes: ["contacts"] });

    expect(result.moved).toEqual({ contacts: 12 });
    expect(userUpdate).toHaveBeenCalled();
  });

  it("rechaza un destino sin scopes en vez de no mover nada en silencio", async () => {
    await expect(
      softDeleteUser("u1", { reassignTo: "u2" }),
    ).rejects.toThrow(/ningún tipo de activo/);
    expect(contactUpdateMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("reasigna antes de eliminar cuando le pasan un destino", async () => {
    await softDeleteUser("u1", { reassignTo: "u2", scopes: ["contacts"] });

    expect(contactUpdateMany).toHaveBeenCalled();
    const orderOk =
      contactUpdateMany.mock.invocationCallOrder[0] <
      userUpdate.mock.invocationCallOrder[0];
    expect(orderOk).toBe(true);
  });

  it("no elimina si la reasignación falla", async () => {
    contactUpdateMany.mockRejectedValue(new Error("pooler caído"));

    await expect(
      softDeleteUser("u1", { reassignTo: "u2", scopes: ["contacts"] }),
    ).rejects.toThrow(/pooler caído/);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("un GERENTE no puede eliminar", async () => {
    session.user = { id: "actor-1", role: "GERENTE" };
    await expect(softDeleteUser("u1")).rejects.toThrow(/Acceso denegado/);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("no permite eliminarse a sí mismo", async () => {
    await expect(softDeleteUser("actor-1")).rejects.toThrow(/tu propia cuenta/);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("no permite eliminar al último administrador", async () => {
    userFindUnique.mockResolvedValue({
      id: "u1", name: "Ana", role: "ADMIN", isActive: true, deletedAt: null,
    });
    userCount.mockResolvedValue(0);

    await expect(softDeleteUser("u1")).rejects.toThrow(/sin administradores activos/);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("no permite eliminar a quien lidera un equipo", async () => {
    teamFindMany.mockResolvedValue([{ name: "Tulum A" }]);
    await expect(softDeleteUser("u1")).rejects.toThrow(/Tulum A/);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("registra la eliminación con action DELETE", async () => {
    await softDeleteUser("u1");
    expect(auditCreate.mock.calls[0][0].data.action).toBe("DELETE");
  });
});

describe("restoreUser", () => {
  it("limpia deletedAt y deja al usuario en INACTIVE, no en ACTIVE", async () => {
    userFindUnique.mockResolvedValue({
      id: "u1", name: "Ana", role: "ASESOR_JR", isActive: false, deletedAt: new Date(),
    });

    await restoreUser("u1");

    const { data } = userUpdate.mock.calls[0][0];
    expect(data.deletedAt).toBeNull();
    expect(data.status).toBe("INACTIVE");
    expect(data.isActive).toBe(false);
  });

  it("rechaza restaurar a alguien que no está eliminado", async () => {
    await expect(restoreUser("u1")).rejects.toThrow(/no está eliminado/);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

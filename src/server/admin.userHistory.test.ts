import { describe, it, expect, vi, beforeEach } from "vitest";

// Mismo patrón que admin.deleteUser.test.ts / admin.protecciones.test.ts.
const session = { user: { id: "actor-1", role: "DIRECTOR" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => session }));

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const userFindMany = vi.fn();
const userCount = vi.fn();
const configFindUnique = vi.fn();
const auditLogCreate = vi.fn();
const auditLogFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      update: (...a: unknown[]) => userUpdate(...a),
      findMany: (...a: unknown[]) => userFindMany(...a),
      count: (...a: unknown[]) => userCount(...a),
    },
    systemConfig: {
      findUnique: (...a: unknown[]) => configFindUnique(...a),
    },
    auditLog: {
      create: (...a: unknown[]) => auditLogCreate(...a),
      findMany: (...a: unknown[]) => auditLogFindMany(...a),
    },
  },
}));

import { deactivateUser, updateUser, getDeletedUsers, getUserAuditHistory } from "./admin";

const ASESOR_TARGET = {
  id: "asesor-1",
  name: "Asesor Uno",
  email: "asesor@nativatulum.mx",
  role: "ASESOR_SR",
  isActive: true,
};

beforeEach(() => {
  for (const m of [userFindUnique, userUpdate, userFindMany, userCount, configFindUnique, auditLogCreate, auditLogFindMany]) {
    m.mockReset();
  }
  configFindUnique.mockResolvedValue(null);
  session.user.role = "DIRECTOR";
  session.user.id = "actor-1";
  userCount.mockResolvedValue(3);
  auditLogCreate.mockResolvedValue({ id: "audit-1" });
  userUpdate.mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: args.where.id,
    name: ASESOR_TARGET.name,
    email: ASESOR_TARGET.email,
    ...args.data,
  }));
});

describe("deactivateUser deja rastro en AuditLog", () => {
  it("escribe un UPDATE con field:isActive, from:true, to:false", async () => {
    userFindUnique.mockResolvedValue(ASESOR_TARGET);

    await deactivateUser(ASESOR_TARGET.id);

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    const { data } = auditLogCreate.mock.calls[0][0];
    expect(data).toMatchObject({
      userId: "actor-1",
      action: "UPDATE",
      entity: "User",
      entityId: ASESOR_TARGET.id,
      changes: {
        field: "isActive",
        from: true,
        to: false,
        targetName: ASESOR_TARGET.name,
        targetEmail: ASESOR_TARGET.email,
      },
    });
    expect(JSON.stringify(data)).not.toMatch(/passwordHash|otpHash/i);
  });
});

describe("updateUser deja rastro en AuditLog solo cuando isActive realmente cambia", () => {
  it("reactivar (isActive:true) escribe un UPDATE con from:false, to:true", async () => {
    const inactivo = { ...ASESOR_TARGET, isActive: false };
    userFindUnique.mockResolvedValue(inactivo);

    await updateUser(ASESOR_TARGET.id, { isActive: true });

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    const { data } = auditLogCreate.mock.calls[0][0];
    expect(data).toMatchObject({
      action: "UPDATE",
      entity: "User",
      entityId: ASESOR_TARGET.id,
      changes: { field: "isActive", from: false, to: true },
    });
  });

  it("un update que no toca isActive no escribe nada en AuditLog", async () => {
    userFindUnique.mockResolvedValue(ASESOR_TARGET);

    await updateUser(ASESOR_TARGET.id, { phone: "9981234567" });

    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it("mandar el mismo valor que ya tenía (isActive:true sobre un activo) no escribe nada", async () => {
    userFindUnique.mockResolvedValue(ASESOR_TARGET); // ya está isActive:true

    await updateUser(ASESOR_TARGET.id, { isActive: true });

    expect(auditLogCreate).not.toHaveBeenCalled();
  });
});

describe("getDeletedUsers", () => {
  it("consulta con deletedAt no nulo y requiere rol admin", async () => {
    userFindMany.mockResolvedValue([]);

    await getDeletedUsers();

    expect(userFindMany).toHaveBeenCalledTimes(1);
    const args = userFindMany.mock.calls[0][0];
    expect(args.where).toEqual({ deletedAt: { not: null } });
  });

  it("rechaza a quien no tiene rol admin", async () => {
    session.user.role = "ASESOR_SR";

    await expect(getDeletedUsers()).rejects.toThrow(/acceso denegado/i);
    expect(userFindMany).not.toHaveBeenCalled();
  });
});

describe("getUserAuditHistory", () => {
  it("incluye los DELETE y los UPDATE de isActive, y descarta otros UPDATE (p.ej. reset de contraseña)", async () => {
    const now = new Date("2026-09-20T12:00:00Z");
    auditLogFindMany.mockResolvedValue([
      {
        id: "log-3",
        action: "DELETE",
        entityId: "u-3",
        userId: "actor-1",
        user: { name: "Actor Uno" },
        changes: { name: "Eliminado Tres", email: "e3@nativatulum.mx", role: "ASESOR_SR" },
        createdAt: now,
      },
      {
        id: "log-2",
        action: "UPDATE",
        entityId: "u-2",
        userId: "actor-1",
        user: { name: "Actor Uno" },
        changes: { field: "isActive", from: true, to: false, targetName: "Usuario Dos", targetEmail: "e2@nativatulum.mx" },
        createdAt: now,
      },
      {
        id: "log-1",
        action: "UPDATE",
        entityId: "u-1",
        userId: "actor-1",
        user: { name: "Actor Uno" },
        // Este es un reset de contraseña (resetUserPassword), no un toggle de isActive.
        changes: { field: "passwordHash", reset: true, targetEmail: "e1@nativatulum.mx" },
        createdAt: now,
      },
    ]);

    const events = await getUserAuditHistory();

    expect(events).toHaveLength(2);
    expect(events.find((e) => e.id === "log-3")).toMatchObject({ kind: "deleted", targetName: "Eliminado Tres" });
    expect(events.find((e) => e.id === "log-2")).toMatchObject({ kind: "deactivated", targetName: "Usuario Dos" });
    expect(events.find((e) => e.id === "log-1")).toBeUndefined();
  });

  it("marca kind:'activated' cuando el toggle fue to:true", async () => {
    auditLogFindMany.mockResolvedValue([
      {
        id: "log-1",
        action: "UPDATE",
        entityId: "u-1",
        userId: "actor-1",
        user: { name: "Actor Uno" },
        changes: { field: "isActive", from: false, to: true, targetName: "Usuario Uno", targetEmail: "e1@nativatulum.mx" },
        createdAt: new Date(),
      },
    ]);

    const events = await getUserAuditHistory();

    expect(events).toEqual([expect.objectContaining({ kind: "activated" })]);
  });
});

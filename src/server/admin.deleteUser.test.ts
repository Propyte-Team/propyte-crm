import { describe, it, expect, vi, beforeEach } from "vitest";

// Mismo patrón que admin.protecciones.test.ts: mockear la sesión y Prisma con
// vi.fn() para mover al actor y al objetivo entre roles sin tocar una base real.
const session = { user: { id: "actor-1", role: "DIRECTOR" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => session }));

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const userCount = vi.fn();
const configFindUnique = vi.fn();
const auditLogCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      update: (...a: unknown[]) => userUpdate(...a),
      count: (...a: unknown[]) => userCount(...a),
    },
    systemConfig: {
      findUnique: (...a: unknown[]) => configFindUnique(...a),
    },
    auditLog: {
      create: (...a: unknown[]) => auditLogCreate(...a),
    },
  },
}));

import { deleteUserPermanently } from "./admin";

const ADMIN_TARGET = { id: "admin-2", name: "Otro Admin", email: "admin2@nativatulum.mx", role: "ADMIN", isActive: true };
const ASESOR_TARGET = { id: "asesor-1", name: "Asesor Uno", email: "asesor@nativatulum.mx", role: "ASESOR_SR", isActive: true };

beforeEach(() => {
  for (const m of [userFindUnique, userUpdate, userCount, configFindUnique, auditLogCreate]) m.mockReset();
  configFindUnique.mockResolvedValue(null);
  session.user.role = "DIRECTOR";
  session.user.id = "actor-1";
  userCount.mockResolvedValue(3);
  userUpdate.mockImplementation(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: args.where.id,
    name: "Nombre",
    email: "correo@nativatulum.mx",
    ...args.data,
  }));
  auditLogCreate.mockResolvedValue({});
});

describe("deleteUserPermanently — reutiliza las mismas reglas que deactivateUser", () => {
  it("GERENTE/DIRECTOR no puede eliminar a un ADMIN (Regla A)", async () => {
    session.user.role = "DIRECTOR";
    userFindUnique.mockResolvedValue(ADMIN_TARGET);

    await expect(deleteUserPermanently(ADMIN_TARGET.id)).rejects.toThrow(/administrador/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("nadie se elimina a sí mismo (Regla C)", async () => {
    session.user.role = "ADMIN";
    session.user.id = "actor-1";
    const self = { ...ADMIN_TARGET, id: "actor-1" };
    userFindUnique.mockResolvedValue(self);
    userCount.mockResolvedValue(3);

    await expect(deleteUserPermanently("actor-1")).rejects.toThrow(/propia cuenta/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("no se puede eliminar al último ADMIN activo (Regla D)", async () => {
    session.user.role = "ADMIN";
    session.user.id = "actor-1";
    userFindUnique.mockResolvedValue(ADMIN_TARGET);
    userCount.mockResolvedValue(1);

    await expect(deleteUserPermanently(ADMIN_TARGET.id)).rejects.toThrow(/último administrador/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("un usuario ya eliminado (deletedAt no nulo) se reporta como no encontrado", async () => {
    // El where de la consulta ya filtra deletedAt:null; el mock solo necesita
    // devolver null para simular ese caso.
    userFindUnique.mockResolvedValue(null);

    await expect(deleteUserPermanently("ya-eliminado")).rejects.toThrow(/no encontrado/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteUserPermanently — a diferencia de deactivateUser, corta el acceso ya mismo", () => {
  it("pone isActive:false Y deletedAt (no solo isActive, como deactivateUser)", async () => {
    session.user.role = "GERENTE";
    userFindUnique.mockResolvedValue(ASESOR_TARGET);

    await deleteUserPermanently(ASESOR_TARGET.id);

    expect(userUpdate).toHaveBeenCalledTimes(1);
    const args = userUpdate.mock.calls[0][0];
    expect(args.where).toEqual({ id: ASESOR_TARGET.id });
    expect(args.data.isActive).toBe(false);
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it("deja un registro de auditoría con action: DELETE, sin datos sensibles", async () => {
    session.user.role = "GERENTE";
    session.user.id = "gerente-1";
    userFindUnique.mockResolvedValue(ASESOR_TARGET);

    await deleteUserPermanently(ASESOR_TARGET.id);

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    const { data } = auditLogCreate.mock.calls[0][0];
    expect(data).toMatchObject({
      userId: "gerente-1",
      action: "DELETE",
      entity: "User",
      entityId: ASESOR_TARGET.id,
    });
    expect(JSON.stringify(data)).not.toMatch(/passwordHash|otpHash/i);
  });

  it("devuelve id/name/email del usuario eliminado", async () => {
    session.user.role = "GERENTE";
    userFindUnique.mockResolvedValue(ASESOR_TARGET);
    // El select real de prisma.user.update devuelve las columnas actuales de la fila
    // (name/email no cambian con esta operación), no lo que viaja en `data` — a
    // diferencia del mock por defecto de beforeEach, que solo simula ese eco genérico.
    userUpdate.mockResolvedValue({ id: ASESOR_TARGET.id, name: ASESOR_TARGET.name, email: ASESOR_TARGET.email });

    await expect(deleteUserPermanently(ASESOR_TARGET.id)).resolves.toMatchObject({
      id: ASESOR_TARGET.id,
      name: ASESOR_TARGET.name,
      email: ASESOR_TARGET.email,
    });
  });

  it("GERENTE puede eliminar a un usuario NO-ADMIN, igual que puede desactivarlo", async () => {
    session.user.role = "GERENTE";
    session.user.id = "gerente-1";
    userFindUnique.mockResolvedValue(ASESOR_TARGET);

    await expect(deleteUserPermanently(ASESOR_TARGET.id)).resolves.toBeTruthy();
  });
});

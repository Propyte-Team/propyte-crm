import { describe, it, expect, vi, beforeEach } from "vitest";

// Nota: agrupados en vi.hoisted() porque vi.mock("@/lib/db", factory) se
// hoistea por encima de TODO el código top-level del archivo (incluyendo un
// `const db = {...}` normal). Sin esto, la factory intenta leer `db` antes
// de que exista -> "Cannot access 'db' before initialization". Los vi.fn()
// sueltos sí se hoistean solos; el objeto que los envuelve, no.
const { userUpdate, userFindUnique, userCount, userFindMany, teamFindMany, territoryMemberCount, auditCreate, db } =
  vi.hoisted(() => {
    const userUpdate = vi.fn();
    const userFindUnique = vi.fn();
    const userCount = vi.fn();
    const userFindMany = vi.fn();
    const teamFindMany = vi.fn();
    const territoryMemberCount = vi.fn();
    const auditCreate = vi.fn();

    const db = {
      user: {
        update: (...a: unknown[]) => userUpdate(...a),
        findUnique: (...a: unknown[]) => userFindUnique(...a),
        count: (...a: unknown[]) => userCount(...a),
        findMany: (...a: unknown[]) => userFindMany(...a),
      },
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
      auditCreate,
      db,
    };
  });

vi.mock("@/lib/db", () => ({
  default: {
    ...db,
    // La transacción corre el callback con el mismo cliente falso.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "actor-1", role: "DIRECTOR" } }),
}));

import { setUserStatus } from "./users-lifecycle";

beforeEach(() => {
  for (const m of [
    userUpdate,
    userFindUnique,
    userCount,
    userFindMany,
    teamFindMany,
    territoryMemberCount,
    auditCreate,
  ]) {
    m.mockReset();
  }
  userFindUnique.mockResolvedValue({
    id: "u1",
    name: "Ana",
    role: "ASESOR_JR",
    isActive: true,
    deletedAt: null,
  });
  userCount.mockResolvedValue(3);
  userFindMany.mockResolvedValue([]);
  teamFindMany.mockResolvedValue([]);
  territoryMemberCount.mockResolvedValue(0);
  userUpdate.mockResolvedValue({ id: "u1", name: "Ana", status: "SUSPENDED", isActive: false });
  auditCreate.mockResolvedValue({});
});

describe("setUserStatus — el espejo isActive", () => {
  it("ACTIVE deja isActive en true y limpia los datos de suspensión", async () => {
    await setUserStatus("u1", "ACTIVE");

    const { data } = userUpdate.mock.calls[0][0];
    expect(data.status).toBe("ACTIVE");
    expect(data.isActive).toBe(true);
    expect(data.suspendedAt).toBeNull();
    expect(data.suspensionReason).toBeNull();
  });

  it("SUSPENDED deja isActive en false y sella la fecha y el motivo", async () => {
    await setUserStatus("u1", "SUSPENDED", "Incapacidad médica");

    const { data } = userUpdate.mock.calls[0][0];
    expect(data.status).toBe("SUSPENDED");
    expect(data.isActive).toBe(false);
    expect(data.suspensionReason).toBe("Incapacidad médica");
    expect(data.suspendedAt).toBeInstanceOf(Date);
  });

  it("INACTIVE deja isActive en false", async () => {
    await setUserStatus("u1", "INACTIVE");

    const { data } = userUpdate.mock.calls[0][0];
    expect(data.status).toBe("INACTIVE");
    expect(data.isActive).toBe(false);
  });

  it("registra quién hizo el cambio", async () => {
    await setUserStatus("u1", "INACTIVE");

    const { data } = userUpdate.mock.calls[0][0];
    expect(data.statusChangedById).toBe("actor-1");
    expect(data.statusChangedAt).toBeInstanceOf(Date);
  });
});

describe("setUserStatus — validación y guards", () => {
  it("exige motivo al suspender", async () => {
    await expect(setUserStatus("u1", "SUSPENDED")).rejects.toThrow(/motivo/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("rechaza un estado que no existe", async () => {
    await expect(setUserStatus("u1", "VACACIONES" as never)).rejects.toThrow();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("no permite suspenderse a sí mismo", async () => {
    await expect(setUserStatus("actor-1", "SUSPENDED", "porque sí")).rejects.toThrow(
      /tu propia cuenta/,
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("no permite dar de baja al último administrador", async () => {
    userFindUnique.mockResolvedValue({
      id: "u1", name: "Ana", role: "ADMIN", isActive: true, deletedAt: null,
    });
    userCount.mockResolvedValue(0);

    await expect(setUserStatus("u1", "INACTIVE")).rejects.toThrow(
      /sin administradores activos/,
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("no permite suspender a quien tiene subordinados", async () => {
    userFindMany.mockResolvedValue([{ name: "Beto" }]);

    await expect(setUserStatus("u1", "SUSPENDED", "vacaciones")).rejects.toThrow(
      /Beto/,
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("reactivar a ACTIVE no exige que no tenga dependientes", async () => {
    userFindMany.mockResolvedValue([{ name: "Beto" }]);

    await expect(setUserStatus("u1", "ACTIVE")).resolves.toBeTruthy();
    expect(userUpdate).toHaveBeenCalled();
  });

  it("deja rastro en AuditLog", async () => {
    await setUserStatus("u1", "INACTIVE");

    const { data } = auditCreate.mock.calls[0][0];
    expect(data.userId).toBe("actor-1");
    expect(data.action).toBe("UPDATE");
    expect(data.entity).toBe("User");
    expect(data.entityId).toBe("u1");
    expect(data.changes).toMatchObject({ status: "INACTIVE" });
  });
});

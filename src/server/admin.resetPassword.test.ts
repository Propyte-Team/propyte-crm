import { describe, it, expect, vi, beforeEach } from "vitest";
import { compare } from "bcryptjs";

const session = { user: { id: "actor-1", role: "DIRECTOR" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => session }));

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      update: (...a: unknown[]) => userUpdate(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { resetUserPassword } from "./admin";

const TARGET = { id: "u-9", name: "Design", email: "design@nativatulum.mx", role: "MARKETING" };

beforeEach(() => {
  for (const m of [userFindUnique, userUpdate, auditCreate]) m.mockReset();
  session.user.role = "DIRECTOR";
  session.user.id = "actor-1";
  userFindUnique.mockResolvedValue(TARGET);
  userUpdate.mockResolvedValue({ id: TARGET.id, name: TARGET.name, email: TARGET.email });
  auditCreate.mockResolvedValue({});
});

describe("resetUserPassword — quién puede", () => {
  it("ADMIN y DIRECTOR pueden restablecer", async () => {
    for (const role of ["ADMIN", "DIRECTOR"]) {
      session.user.role = role;
      await expect(resetUserPassword("u-9", "unaClaveLarga1")).resolves.toMatchObject({
        email: "design@nativatulum.mx",
      });
    }
  });

  // Un GERENTE con este poder puede restablecer la contraseña de un DIRECTOR y
  // entrar como él. Sigue administrando usuarios; solo no reparte credenciales.
  it("GERENTE NO puede: sería escalación de privilegios", async () => {
    session.user.role = "GERENTE";
    await expect(resetUserPassword("u-9", "unaClaveLarga1")).rejects.toThrow(/denegado/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("los demás roles tampoco", async () => {
    for (const role of ["TEAM_LEADER", "ASESOR_SR", "ASESOR_JR", "MARKETING", "HOSTESS"]) {
      session.user.role = role;
      await expect(resetUserPassword("u-9", "unaClaveLarga1")).rejects.toThrow(/denegado/i);
    }
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("resetUserPassword — validación", () => {
  it("rechaza contraseñas de menos de 8 caracteres", async () => {
    await expect(resetUserPassword("u-9", "corta7c")).rejects.toThrow();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("404 si el usuario no existe o está borrado", async () => {
    userFindUnique.mockResolvedValue(null);
    await expect(resetUserPassword("fantasma", "unaClaveLarga1")).rejects.toThrow(/no encontrado/i);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("busca al usuario excluyendo los borrados", async () => {
    await resetUserPassword("u-9", "unaClaveLarga1");
    expect(userFindUnique.mock.calls[0][0].where).toMatchObject({ id: "u-9", deletedAt: null });
  });
});

describe("resetUserPassword — qué escribe", () => {
  it("guarda un hash que valida contra la contraseña nueva, nunca el texto plano", async () => {
    await resetUserPassword("u-9", "PropyteSegura2026");

    const data = userUpdate.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(["passwordHash"]);
    expect(data.passwordHash).not.toContain("PropyteSegura2026");
    await expect(compare("PropyteSegura2026", data.passwordHash)).resolves.toBe(true);
    await expect(compare("otraCosaDistinta", data.passwordHash)).resolves.toBe(false);
  });

  it("solo toca passwordHash: no cambia rol, correo ni estado activo", async () => {
    await resetUserPassword("u-9", "unaClaveLarga1");
    const data = userUpdate.mock.calls[0][0].data;
    expect(data.role).toBeUndefined();
    expect(data.email).toBeUndefined();
    expect(data.isActive).toBeUndefined();
  });

  it("no devuelve la contraseña ni el hash a quien la pidió", async () => {
    const result = await resetUserPassword("u-9", "PropyteSegura2026");
    expect(JSON.stringify(result)).not.toContain("PropyteSegura2026");
    expect(JSON.stringify(result)).not.toContain("$2");
  });
});

describe("resetUserPassword — auditoría", () => {
  it("deja rastro de quién se la cambió a quién", async () => {
    await resetUserPassword("u-9", "unaClaveLarga1");

    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      userId: "actor-1",
      action: "UPDATE",
      entity: "User",
      entityId: "u-9",
    });
  });

  // Un log de auditoría que guarda la credencial es peor que no tenerlo: la
  // deja en claro para cualquiera que pueda leer la tabla.
  it("la auditoría NO contiene la contraseña ni el hash", async () => {
    await resetUserPassword("u-9", "PropyteSegura2026");

    const escrito = JSON.stringify(auditCreate.mock.calls[0][0].data);
    expect(escrito).not.toContain("PropyteSegura2026");
    expect(escrito).not.toContain("$2");
  });
});

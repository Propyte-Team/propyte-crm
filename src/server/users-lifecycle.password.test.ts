import { describe, it, expect, vi, beforeEach } from "vitest";
import { compare } from "bcryptjs";

const userUpdate = vi.fn();
const userFindUnique = vi.fn();
const auditCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    user: {
      update: (...a: unknown[]) => userUpdate(...a),
      findUnique: (...a: unknown[]) => userFindUnique(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

const session = { user: { id: "actor-1", role: "DIRECTOR" } };
vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => session,
}));

import { adminResetPassword } from "./users-lifecycle";

beforeEach(() => {
  userUpdate.mockReset();
  userFindUnique.mockReset();
  auditCreate.mockReset();
  userFindUnique.mockResolvedValue({ id: "u1", name: "Ana", email: "ana@propyte.com", deletedAt: null });
  userUpdate.mockResolvedValue({ id: "u1", name: "Ana" });
  auditCreate.mockResolvedValue({});
  session.user = { id: "actor-1", role: "DIRECTOR" };
});

describe("adminResetPassword", () => {
  it("guarda el hash de la contraseña que le pasan, no el texto plano", async () => {
    await adminResetPassword("u1", "MiClaveNueva123");

    const { data } = userUpdate.mock.calls[0][0];
    expect(data.passwordHash).not.toBe("MiClaveNueva123");
    expect(await compare("MiClaveNueva123", data.passwordHash)).toBe(true);
  });

  it("devuelve la contraseña en claro para mostrarla una vez", async () => {
    const result = await adminResetPassword("u1", "MiClaveNueva123");
    expect(result.password).toBe("MiClaveNueva123");
  });

  it("genera una contraseña si no le pasan ninguna", async () => {
    const result = await adminResetPassword("u1");

    expect(result.password).toHaveLength(16);
    const { data } = userUpdate.mock.calls[0][0];
    expect(await compare(result.password, data.passwordHash)).toBe(true);
  });

  it("sella passwordChangedAt", async () => {
    await adminResetPassword("u1", "MiClaveNueva123");
    expect(userUpdate.mock.calls[0][0].data.passwordChangedAt).toBeInstanceOf(Date);
  });

  it("rechaza contraseñas de menos de 8 caracteres", async () => {
    await expect(adminResetPassword("u1", "corta1")).rejects.toThrow(/8 caracteres/);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("no permite cambiarse la propia contraseña desde el panel", async () => {
    await expect(adminResetPassword("actor-1", "MiClaveNueva123")).rejects.toThrow(
      /tu propia cuenta/,
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("un GERENTE no puede cambiar contraseñas", async () => {
    session.user = { id: "actor-1", role: "GERENTE" };
    await expect(adminResetPassword("u1", "MiClaveNueva123")).rejects.toThrow(
      /Acceso denegado/,
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("nunca guarda la contraseña en el AuditLog", async () => {
    await adminResetPassword("u1", "MiClaveNueva123");

    const raw = JSON.stringify(auditCreate.mock.calls[0][0]);
    expect(raw).not.toContain("MiClaveNueva123");
    expect(auditCreate.mock.calls[0][0].data.changes).toMatchObject({
      passwordReset: true,
    });
  });
});

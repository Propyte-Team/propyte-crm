import { describe, it, expect, vi, beforeEach } from "vitest";

const rolePermFindMany = vi.fn();
const overrideFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    rolePermission: { findMany: (...a: unknown[]) => rolePermFindMany(...a) },
    userPermissionOverride: { findUnique: (...a: unknown[]) => overrideFindUnique(...a) },
  },
}));

import { can, explain, invalidatePermissionCache } from "./can";

const DIRECTOR = { id: "u-1", role: "DIRECTOR" };
const MARKETING = { id: "u-2", role: "MARKETING" };

beforeEach(() => {
  rolePermFindMany.mockReset();
  overrideFindUnique.mockReset();
  rolePermFindMany.mockResolvedValue([{ permission: "usuarios.ver" }]);
  overrideFindUnique.mockResolvedValue(null);
  invalidatePermissionCache();
});

describe("can — comodín ADMIN", () => {
  it("ADMIN pasa sin tocar la base", async () => {
    await expect(can({ id: "a-1", role: "ADMIN" }, "usuarios.ver")).resolves.toBe(true);
    expect(rolePermFindMany).not.toHaveBeenCalled();
    expect(overrideFindUnique).not.toHaveBeenCalled();
  });

  it("ADMIN pasa incluso para un permiso que nadie tiene sembrado", async () => {
    rolePermFindMany.mockResolvedValue([]);
    await expect(can({ id: "a-1", role: "ADMIN" }, "permisos.gestionar")).resolves.toBe(true);
  });
});

describe("can — sin sesión", () => {
  it("usuario nulo deniega sin consultar", async () => {
    await expect(can(null, "usuarios.ver")).resolves.toBe(false);
    await expect(can(undefined, "usuarios.ver")).resolves.toBe(false);
    expect(rolePermFindMany).not.toHaveBeenCalled();
  });
});

describe("can — resolución normal", () => {
  it("concede lo que el rol trae sembrado", async () => {
    await expect(can(DIRECTOR, "usuarios.ver")).resolves.toBe(true);
  });

  it("deniega lo que el rol no trae", async () => {
    await expect(can(DIRECTOR, "comisiones.reglas")).resolves.toBe(false);
  });

  it("el override que revoca gana sobre el rol", async () => {
    overrideFindUnique.mockResolvedValue({ granted: false });
    await expect(can(DIRECTOR, "usuarios.ver")).resolves.toBe(false);
  });

  it("el override que concede gana sobre un rol sin el permiso", async () => {
    rolePermFindMany.mockResolvedValue([]);
    overrideFindUnique.mockResolvedValue({ granted: true });
    await expect(can(MARKETING, "comentarios.gestionar")).resolves.toBe(true);
  });
});

describe("can — fail-closed ante errores", () => {
  it("si la base falla, deniega en vez de conceder", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    rolePermFindMany.mockRejectedValue(new Error("conexión caída"));
    await expect(can(DIRECTOR, "usuarios.ver")).resolves.toBe(false);
    err.mockRestore();
  });

  it("un fallo NO se cachea: la siguiente llamada reintenta", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    rolePermFindMany.mockRejectedValueOnce(new Error("caída momentánea"));
    await expect(can(DIRECTOR, "usuarios.ver")).resolves.toBe(false);
    await expect(can(DIRECTOR, "usuarios.ver")).resolves.toBe(true);
    err.mockRestore();
  });
});

describe("can — caché", () => {
  it("dos llamadas seguidas consultan la base una sola vez", async () => {
    await can(DIRECTOR, "usuarios.ver");
    await can(DIRECTOR, "usuarios.ver");
    expect(rolePermFindMany).toHaveBeenCalledTimes(1);
  });

  it("invalidar hace que la siguiente llamada vuelva a consultar", async () => {
    await can(DIRECTOR, "usuarios.ver");
    invalidatePermissionCache(DIRECTOR.id);
    await can(DIRECTOR, "usuarios.ver");
    expect(rolePermFindMany).toHaveBeenCalledTimes(2);
  });

  it("tras invalidar, se ve el valor NUEVO y no el viejo", async () => {
    await expect(can(DIRECTOR, "usuarios.ver")).resolves.toBe(true);
    overrideFindUnique.mockResolvedValue({ granted: false });
    invalidatePermissionCache(DIRECTOR.id);
    await expect(can(DIRECTOR, "usuarios.ver")).resolves.toBe(false);
  });

  it("invalidar a una persona no borra el caché de otra", async () => {
    await can(DIRECTOR, "usuarios.ver");
    await can(MARKETING, "usuarios.ver");
    invalidatePermissionCache(DIRECTOR.id);
    await can(MARKETING, "usuarios.ver");
    expect(rolePermFindMany).toHaveBeenCalledTimes(2); // DIRECTOR y MARKETING
  });

  it("el caché caduca a los 30 s", async () => {
    vi.useFakeTimers();
    try {
      await can(DIRECTOR, "usuarios.ver");
      vi.advanceTimersByTime(31_000);
      await can(DIRECTOR, "usuarios.ver");
      expect(rolePermFindMany).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("explain — de dónde sale la decisión", () => {
  it("dice 'rol' cuando viene del default del rol", async () => {
    await expect(explain(DIRECTOR, "usuarios.ver")).resolves.toEqual({
      allowed: true,
      source: "rol",
    });
  });

  it("dice 'override' cuando viene de una excepción", async () => {
    overrideFindUnique.mockResolvedValue({ granted: false });
    await expect(explain(DIRECTOR, "usuarios.ver")).resolves.toEqual({
      allowed: false,
      source: "override",
    });
  });

  it("dice 'admin-comodin' para un ADMIN", async () => {
    await expect(explain({ id: "a-1", role: "ADMIN" }, "usuarios.ver")).resolves.toEqual({
      allowed: true,
      source: "admin-comodin",
    });
  });
});

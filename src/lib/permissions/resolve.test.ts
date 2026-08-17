import { describe, it, expect } from "vitest";
import { resolvePermission } from "./resolve";

const base = {
  role: "GERENTE",
  permission: "usuarios.ver",
  rolePermissions: ["usuarios.ver", "usuarios.editar"],
};

describe("resolvePermission — precedencia", () => {
  it("ADMIN pasa siempre, aunque su rol no tenga el permiso sembrado", () => {
    expect(
      resolvePermission({ ...base, role: "ADMIN", rolePermissions: [] }),
    ).toEqual({ allowed: true, source: "admin-comodin" });
  });

  it("ADMIN pasa incluso con un override que lo revoca: es el seguro anti-apagón", () => {
    expect(
      resolvePermission({
        ...base,
        role: "ADMIN",
        rolePermissions: [],
        override: { granted: false },
      }),
    ).toEqual({ allowed: true, source: "admin-comodin" });
  });

  it("el override que concede gana sobre un rol que no lo tiene", () => {
    expect(
      resolvePermission({
        ...base,
        permission: "comentarios.gestionar",
        rolePermissions: [],
        override: { granted: true },
      }),
    ).toEqual({ allowed: true, source: "override" });
  });

  it("el override que revoca gana sobre un rol que sí lo tiene", () => {
    // El caso de pantallapdc@: MARKETING gestiona comentarios, la pantalla no.
    expect(
      resolvePermission({
        ...base,
        role: "MARKETING",
        permission: "comentarios.gestionar",
        rolePermissions: ["comentarios.gestionar"],
        override: { granted: false },
      }),
    ).toEqual({ allowed: false, source: "override" });
  });

  it("sin override, manda el default del rol", () => {
    expect(resolvePermission(base)).toEqual({ allowed: true, source: "rol" });
  });
});

describe("resolvePermission — fail-closed", () => {
  it("un permiso que el rol no tiene queda denegado", () => {
    expect(
      resolvePermission({ ...base, permission: "comisiones.reglas" }),
    ).toEqual({ allowed: false, source: "denegado" });
  });

  it("rol ausente, vacío o desconocido queda denegado", () => {
    // Sin permisos sembrados a propósito: la columna `role` de role_permissions
    // es el enum UserRole de Postgres, así que no puede existir una fila para un
    // rol fuera del enum. Un rol desconocido siempre llega con la lista vacía.
    for (const role of [null, undefined, "", "SUPERUSUARIO"]) {
      expect(
        resolvePermission({ ...base, role, rolePermissions: [] }).allowed,
        `rol ${String(role)} debería denegar`,
      ).toBe(false);
    }
  });

  it("un permiso fuera del catálogo queda denegado aunque esté en la lista del rol", () => {
    // Defensa contra una fila vieja en base tras renombrar una clave.
    expect(
      resolvePermission({
        ...base,
        permission: "usuarios.inventado",
        rolePermissions: ["usuarios.inventado"],
      }),
    ).toEqual({ allowed: false, source: "denegado" });
  });

  it("un permiso fuera del catálogo NO se salva ni con override", () => {
    expect(
      resolvePermission({
        ...base,
        permission: "usuarios.inventado",
        rolePermissions: [],
        override: { granted: true },
      }).allowed,
    ).toBe(false);
  });

  it("lista de permisos vacía deniega todo salvo a ADMIN", () => {
    expect(resolvePermission({ ...base, rolePermissions: [] }).allowed).toBe(false);
  });
});

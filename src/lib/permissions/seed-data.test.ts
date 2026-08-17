import { describe, it, expect } from "vitest";
import { ROLE_SEED, LEGACY_ROLE_LISTS, DIVERGENCIAS, PERDIDAS_POR_SENSIBILIDAD } from "./seed-data";
import { ALL_PERMISSIONS, SENSITIVE_PERMISSIONS, isSensitive, type Permission } from "./catalog";
import { resolvePermission } from "./resolve";
import { UserRole } from "@prisma/client";
import { COMMENT_RULES_ROLES } from "@/lib/comments/roles";

/** Lo que la semilla concede hoy a un rol, según ROLE_SEED. */
function seedAllows(role: string, permission: string): boolean {
  return resolvePermission({
    role,
    permission,
    rolePermissions: ROLE_SEED[role as keyof typeof ROLE_SEED] ?? [],
  }).allowed;
}

/** Lo que las listas hardcodeadas conceden hoy. */
function legacyAllows(role: string, permission: string): boolean {
  if (role === "ADMIN") return true;
  const roles: readonly string[] = LEGACY_ROLE_LISTS[permission as Permission] ?? [];
  return roles.includes(role);
}

describe("semilla — ningún permiso sensible se siembra", () => {
  it("ROLE_SEED no contiene claves sensibles", () => {
    for (const [role, permisos] of Object.entries(ROLE_SEED)) {
      for (const p of permisos) {
        expect(isSensitive(p), `${role} no debería traer ${p} sembrado`).toBe(false);
      }
    }
  });

  it("hay al menos un sensible, o el test anterior no prueba nada", () => {
    expect(SENSITIVE_PERMISSIONS.length).toBeGreaterThan(0);
  });

  it("las pérdidas por sensibilidad son reales: hoy sí, después no", () => {
    for (const p of PERDIDAS_POR_SENSIBILIDAD) {
      expect(legacyAllows(p.role, p.permission), `${p.role}×${p.permission} antes`)
        .toBe(true);
      expect(seedAllows(p.role, p.permission), `${p.role}×${p.permission} después`)
        .toBe(false);
    }
  });
});

describe("semilla — solo claves reales y roles reales", () => {
  it("toda clave sembrada existe en el catálogo", () => {
    for (const permisos of Object.values(ROLE_SEED)) {
      for (const p of permisos) expect(ALL_PERMISSIONS).toContain(p);
    }
  });

  it("todo rol sembrado existe en el enum de Prisma", () => {
    const validos = new Set(Object.values(UserRole) as string[]);
    for (const role of Object.keys(ROLE_SEED)) {
      expect(validos.has(role), `rol inexistente: ${role}`).toBe(true);
    }
  });

  it("ADMIN no se siembra: es comodín, sembrarlo duplicaría la verdad", () => {
    expect("ADMIN" in ROLE_SEED).toBe(false);
  });
});

describe("paridad con las listas hardcodeadas", () => {
  const declaradas = new Set(
    DIVERGENCIAS.map((d) => `${d.role}|${d.permission}`),
  );

  it("nadie gana ni pierde acceso, salvo las divergencias declaradas", () => {
    const inesperadas: string[] = [];

    for (const role of Object.values(UserRole) as string[]) {
      for (const permission of ALL_PERMISSIONS) {
        // permisos.gestionar no existe hoy: no hay con qué comparar.
        if (permission === "permisos.gestionar") continue;
        // Los sensibles no se siembran por diseño; su paridad no aplica.
        if (isSensitive(permission)) continue;

        const antes = legacyAllows(role, permission);
        const despues = seedAllows(role, permission);
        if (antes === despues) continue;

        if (!declaradas.has(`${role}|${permission}`)) {
          inesperadas.push(`${role} × ${permission}: ${antes} → ${despues}`);
        }
      }
    }

    expect(inesperadas, `divergencias NO declaradas:\n${inesperadas.join("\n")}`)
      .toEqual([]);
  });

  it("toda divergencia declarada ocurre de verdad", () => {
    for (const d of DIVERGENCIAS) {
      expect(legacyAllows(d.role, d.permission), `${d.role}×${d.permission} antes`)
        .toBe(d.antes);
      expect(seedAllows(d.role, d.permission), `${d.role}×${d.permission} después`)
        .toBe(d.despues);
    }
  });

  it("toda divergencia lleva un motivo escrito", () => {
    for (const d of DIVERGENCIAS) {
      expect(d.motivo.length, `${d.role}×${d.permission} sin motivo`).toBeGreaterThan(30);
    }
  });

  // LEGACY_ROLE_LISTS es una transcripción a mano, así que la red de paridad
  // mide contra lo que alguien escribió, no contra el código. De las 8 listas
  // solo esta es importable (las otras son constantes privadas dentro de
  // "use server" o route.ts). Anclarla convierte una fila de transcripción en
  // una fila verificada: si alguien edita COMMENT_RULES_ROLES, esto truena.
  it("la fila de comentarios está anclada a su fuente real, no transcrita", () => {
    const realSinAdmin = [...COMMENT_RULES_ROLES].filter((r) => r !== "ADMIN").sort();
    expect([...LEGACY_ROLE_LISTS["comentarios.gestionar"]].sort()).toEqual(realSinAdmin);
  });
});

describe("la divergencia decidida el 2026-08-17", () => {
  it("GERENTE pierde las API keys y no gana nada a cambio", () => {
    expect(seedAllows("GERENTE", "integraciones.apikeys")).toBe(false);
    expect(legacyAllows("GERENTE", "integraciones.apikeys")).toBe(true);
  });

  it("GERENTE conserva los conectores: la decisión era solo sobre las API keys", () => {
    expect(seedAllows("GERENTE", "integraciones.conectores")).toBe(true);
  });

  it("DIRECTOR conserva las API keys: la decisión era solo sobre GERENTE", () => {
    expect(seedAllows("DIRECTOR", "integraciones.apikeys")).toBe(true);
  });

  it("MARKETING conserva los comentarios (PR #12, ya en producción)", () => {
    expect(seedAllows("MARKETING", "comentarios.gestionar")).toBe(true);
  });
});

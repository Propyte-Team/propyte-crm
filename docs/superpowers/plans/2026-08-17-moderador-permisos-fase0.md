# Moderador de permisos — Fase 0 (cimientos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la capa de permisos —catálogo, tablas, semilla y el helper `can()`— sin que ninguna superficie del CRM la use todavía, de modo que se pueda desplegar sin cambiar el comportamiento de nada.

**Architecture:** Un catálogo de permisos en código (TypeScript, no en base) define las claves válidas. Dos tablas Postgres guardan el default por rol (`role_permissions`) y las excepciones por persona (`user_permission_overrides`, con `granted` de dos estados). Un módulo puro `resolvePermission()` decide, y un envoltorio `can()` le añade el acceso a base y un caché corto. La fase 0 termina con todo probado y cero consumidores: ninguna ruta ni server action llama a `can()` todavía.

**Tech Stack:** Next.js 14 (App Router), Prisma 6 sobre Postgres/Supabase con `multiSchema`, NextAuth v4, Vitest, TypeScript.

**Spec:** [`docs/superpowers/specs/2026-08-17-moderador-permisos-design.md`](../specs/2026-08-17-moderador-permisos-design.md)

## Global Constraints

- **Esquema Postgres:** todo modelo nuevo lleva `@@schema("propyte_crm")` y `@@map` en snake_case. El proyecto usa `previewFeatures = ["multiSchema"]`.
- **El DDL a producción es manual.** Este repo tiene una sola migración de Prisma (marzo). Las tablas nuevas se crean con `apply_migration` del MCP de Supabase, y el `schema.prisma` se actualiza para reflejarlas. **El DDL exige autorización explícita de Luis** con el texto exacto `autorizado: aplicar <nombre_migracion> a prod`. Sin ese texto, no ejecutar DDL: dejar la migración escrita y detenerse.
- **Fail-closed siempre.** Rol desconocido, permiso desconocido, tabla vacía o error → `false`. Nunca un default permisivo.
- **`ADMIN` es comodín**: `can()` devuelve `true` antes de consultar nada.
- **Permisos sensibles** (`sensitive: true`): jamás se siembran a un rol. Hoy son exactamente dos: `usuarios.password` y `permisos.gestionar`.
- **Módulos puros separados del acceso a base.** La lógica de decisión se prueba sin mockear Prisma, igual que `src/lib/rbac/query-scope.ts` y `src/components/layout/nav-config.ts`.
- **Idioma:** identificadores en inglés donde el repo ya lo hace (modelos Prisma), comentarios y mensajes de error en español, como el resto de `src/server/admin.ts`.
- **Nadie consume `can()` en esta fase.** Si una tarea te tienta a modificar un guard existente, no lo hagas: eso es fase 1.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/permissions/catalog.ts` | **Crear.** Las claves de permiso válidas y cuáles son sensibles. Módulo puro, sin imports. |
| `src/lib/permissions/catalog.test.ts` | **Crear.** Fija la forma del catálogo y la lista de sensibles. |
| `src/lib/permissions/resolve.ts` | **Crear.** `resolvePermission()`: la decisión pura. Sin Prisma, sin sesión. |
| `src/lib/permissions/resolve.test.ts` | **Crear.** Tabla de verdad completa. |
| `src/lib/permissions/seed-data.ts` | **Crear.** La semilla (rol → permisos) y la lista `DIVERGENCIAS`. |
| `src/lib/permissions/seed-data.test.ts` | **Crear.** Paridad con las listas hardcodeadas + divergencias declaradas. |
| `src/lib/permissions/can.ts` | **Crear.** `can()`: sesión + Prisma + caché sobre `resolvePermission`. |
| `src/lib/permissions/can.test.ts` | **Crear.** Comodín ADMIN, caché e invalidación. |
| `prisma/schema.prisma` | **Modificar.** Dos modelos nuevos + relación en `User`. |
| `prisma/migrations/manual/2026-08-17_permissions_tables.sql` | **Crear.** El DDL, para aplicar con autorización. |
| `scripts/seed-permissions.ts` | **Crear.** Escribe la semilla en base. Idempotente. |

---

## Task 1: El catálogo de permisos

**Files:**
- Create: `src/lib/permissions/catalog.ts`
- Test: `src/lib/permissions/catalog.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `PERMISSIONS` (objeto), `type Permission` (unión de claves), `isPermission(v: string): v is Permission`, `isSensitive(p: string): boolean`, `ALL_PERMISSIONS: Permission[]`, `SENSITIVE_PERMISSIONS: Permission[]`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/permissions/catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PERMISSIONS,
  ALL_PERMISSIONS,
  SENSITIVE_PERMISSIONS,
  isPermission,
  isSensitive,
} from "./catalog";

describe("catálogo de permisos", () => {
  it("toda clave tiene etiqueta legible", () => {
    for (const key of ALL_PERMISSIONS) {
      expect(PERMISSIONS[key].label.length, `${key} sin etiqueta`).toBeGreaterThan(3);
    }
  });

  it("las claves usan el formato modulo.accion", () => {
    for (const key of ALL_PERMISSIONS) {
      expect(key, `${key} no es modulo.accion`).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it("los sensibles son exactamente los dos decididos", () => {
    expect([...SENSITIVE_PERMISSIONS].sort()).toEqual([
      "permisos.gestionar",
      "usuarios.password",
    ]);
  });

  it("isSensitive coincide con la lista", () => {
    expect(isSensitive("usuarios.password")).toBe(true);
    expect(isSensitive("permisos.gestionar")).toBe(true);
    expect(isSensitive("usuarios.ver")).toBe(false);
    // integraciones.gestionar NO es sensible a propósito: marcarlo se lo
    // quitaría también a DIRECTOR, y eso nadie lo decidió. Ver spec §4.1.
    expect(isSensitive("integraciones.gestionar")).toBe(false);
  });

  it("isPermission rechaza lo que no está en el catálogo", () => {
    expect(isPermission("usuarios.ver")).toBe(true);
    expect(isPermission("usuarios.inventado")).toBe(false);
    expect(isPermission("")).toBe(false);
  });

  it("cubre las superficies que migrará la fase 1", () => {
    for (const key of [
      "usuarios.ver",
      "usuarios.editar",
      "usuarios.password",
      "comisiones.reglas",
      "config.actividad",
      "integraciones.gestionar",
      "bot.configurar",
      "comentarios.gestionar",
      "permisos.gestionar",
    ]) {
      expect(ALL_PERMISSIONS, `falta ${key}`).toContain(key);
    }
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/permissions/catalog.test.ts`
Expected: FAIL — `Failed to load url ./catalog`

- [ ] **Step 3: Escribir la implementación mínima**

Crear `src/lib/permissions/catalog.ts`:

```ts
// Catálogo de permisos — módulo PURO (sin imports, testeable en node).
//
// Vive en código y no en base a propósito: una clave de permiso está acoplada
// al código que la consulta. Si viviera en base, alguien podría borrarla desde
// una UI y dejar un can() preguntando por algo inexistente. En código,
// TypeScript no deja escribir una clave que no existe.
//
// `sensitive: true` = permite volverse otra persona o repartirse el resto de
// permisos. Un permiso sensible NUNCA tiene default de rol: solo se concede a
// una persona concreta y con razón escrita. Ver spec §4.1.

export interface PermissionMeta {
  label: string;
  sensitive?: true;
}

export const PERMISSIONS = {
  "usuarios.ver": { label: "Ver la lista de usuarios" },
  "usuarios.editar": { label: "Crear y editar usuarios" },
  "usuarios.password": { label: "Restablecer contraseñas de otros", sensitive: true },
  "comisiones.reglas": { label: "Editar las reglas de comisión" },
  "config.actividad": { label: "Configurar el acuerdo de actividad" },
  // NO sensible: marcarlo se lo quitaría también a DIRECTOR. Lo único
  // decidido fue que GERENTE lo pierda, vía DIVERGENCIAS. Ver spec §4.1.
  "integraciones.gestionar": { label: "Conectores, webhooks y API keys" },
  "bot.configurar": { label: "Configuración del bot, playbooks y agentes" },
  "comentarios.gestionar": { label: "Reglas de comentarios en redes" },
  "permisos.gestionar": { label: "Administrar este moderador de permisos", sensitive: true },
} as const satisfies Record<string, PermissionMeta>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const SENSITIVE_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => (PERMISSIONS[p] as PermissionMeta).sensitive === true,
);

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

export function isSensitive(value: string): boolean {
  return isPermission(value) && (PERMISSIONS[value] as PermissionMeta).sensitive === true;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/permissions/catalog.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions/catalog.ts src/lib/permissions/catalog.test.ts
git commit -m "feat(permisos): catálogo de permisos en código

Las claves viven en TypeScript y no en base: una clave está acoplada al
código que la consulta, y en base alguien podría borrarla dejando un
can() preguntando por algo inexistente.

integraciones.gestionar queda NO sensible a propósito — marcarlo se lo
quitaría también a DIRECTOR, y lo único decidido fue que GERENTE lo
pierda."
```

---

## Task 2: La decisión pura — `resolvePermission()`

**Files:**
- Create: `src/lib/permissions/resolve.ts`
- Test: `src/lib/permissions/resolve.test.ts`

**Interfaces:**
- Consumes: `Permission`, `isPermission` de `./catalog`.
- Produces:
  - `type PermissionSource = "admin-comodin" | "override" | "rol" | "denegado"`
  - `interface PermissionDecision { allowed: boolean; source: PermissionSource }`
  - `resolvePermission(input: { role: string | null | undefined; permission: string; rolePermissions: readonly string[]; override?: { granted: boolean } | null }): PermissionDecision`

`source` no es adorno: la vista de Persona del moderador (fase 2) muestra *de dónde* sale cada permiso, y resolverlo aquí evita recalcularlo en la UI.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/permissions/resolve.test.ts`:

```ts
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
    for (const role of [null, undefined, "", "SUPERUSUARIO"]) {
      expect(
        resolvePermission({ ...base, role }).allowed,
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
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/permissions/resolve.test.ts`
Expected: FAIL — `Failed to load url ./resolve`

- [ ] **Step 3: Escribir la implementación mínima**

Crear `src/lib/permissions/resolve.ts`:

```ts
// La decisión de permiso — módulo PURO: sin Prisma, sin sesión, sin caché.
// Separado de can.ts para poder probar la tabla de verdad completa sin
// mockear la base, igual que hace src/lib/rbac/query-scope.ts.
import { isPermission } from "./catalog";

export type PermissionSource = "admin-comodin" | "override" | "rol" | "denegado";

export interface PermissionDecision {
  allowed: boolean;
  /** De dónde sale la decisión. La vista de Persona del moderador lo muestra. */
  source: PermissionSource;
}

export interface ResolveInput {
  role: string | null | undefined;
  permission: string;
  /** Permisos sembrados para ese rol. */
  rolePermissions: readonly string[];
  /** Excepción para esa persona, si existe. */
  override?: { granted: boolean } | null;
}

const DENEGADO: PermissionDecision = { allowed: false, source: "denegado" };

/**
 * Orden de precedencia, de mayor a menor:
 *   1. ADMIN → true sin consultar nada (seguro anti-apagón: ninguna
 *      combinación de checkboxes puede dejar la casa sin llave).
 *   2. Override de la persona → su `granted`, en ambos sentidos.
 *   3. Default del rol.
 *   4. Nada → false.
 */
export function resolvePermission(input: ResolveInput): PermissionDecision {
  const { role, permission, rolePermissions, override } = input;

  if (role === "ADMIN") return { allowed: true, source: "admin-comodin" };

  // Una clave fuera del catálogo no se concede por ninguna vía. Protege
  // contra filas viejas en base después de renombrar un permiso.
  if (!isPermission(permission)) return DENEGADO;

  if (!role) return DENEGADO;

  if (override) return { allowed: override.granted, source: "override" };

  if (rolePermissions.includes(permission)) return { allowed: true, source: "rol" };

  return DENEGADO;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/permissions/resolve.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions/resolve.ts src/lib/permissions/resolve.test.ts
git commit -m "feat(permisos): resolvePermission, la decisión pura

Precedencia: ADMIN comodín > override de la persona > default del rol >
denegado. El comodín va antes de todo para que ninguna combinación de
checkboxes pueda dejar la casa sin llave.

Una clave fuera del catálogo se deniega por cualquier vía, incluido un
override que la conceda: protege contra filas viejas tras un renombrado."
```

---

## Task 3: La semilla y las divergencias declaradas

**Files:**
- Create: `src/lib/permissions/seed-data.ts`
- Test: `src/lib/permissions/seed-data.test.ts`

**Interfaces:**
- Consumes: `Permission`, `ALL_PERMISSIONS`, `SENSITIVE_PERMISSIONS`, `isSensitive` de `./catalog`.
- Produces:
  - `ROLE_SEED: Record<string, readonly Permission[]>`
  - `LEGACY_ROLE_LISTS: Record<Permission, readonly string[]>` — quién tiene cada permiso HOY, según las listas hardcodeadas
  - `DIVERGENCIAS: readonly { role: string; permission: Permission; antes: boolean; despues: boolean; motivo: string }[]`

**Contexto para quien implemente — de dónde sale cada lista.** Estas son las listas hardcodeadas reales del repo hoy; no las adivines, están verificadas:

| Permiso | Roles hoy | Fuente |
|---|---|---|
| `usuarios.ver`, `usuarios.editar`, `comisiones.reglas`, `config.actividad`, `integraciones.gestionar` | ADMIN, DIRECTOR, GERENTE | `ADMIN_ROLES` en `src/server/admin.ts:18` |
| `usuarios.password` | ADMIN, DIRECTOR | `PASSWORD_RESET_ROLES` en `src/server/admin.ts:26` |
| `bot.configurar` | ADMIN, DIRECTOR, GERENTE | `ADMIN_ROLES` en `src/server/bot-config.ts:8`, `bot-playbook.ts:10`, `bot-agents.ts:9` |
| `comentarios.gestionar` | ADMIN, DIRECTOR, GERENTE, MARKETING | `COMMENT_RULES_ROLES` en `src/lib/comments/roles.ts` |
| `permisos.gestionar` | *(no existe hoy)* | — |

`ADMIN` no se siembra en ninguna lista: es comodín en `resolvePermission`, y sembrarlo duplicaría la verdad.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/permissions/seed-data.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ROLE_SEED, LEGACY_ROLE_LISTS, DIVERGENCIAS } from "./seed-data";
import { ALL_PERMISSIONS, SENSITIVE_PERMISSIONS, isSensitive } from "./catalog";
import { resolvePermission } from "./resolve";
import { UserRole } from "@prisma/client";

/** Lo que la semilla concede hoy a un rol, según ROLE_SEED. */
function seedAllows(role: string, permission: string): boolean {
  return resolvePermission({
    role,
    permission,
    rolePermissions: ROLE_SEED[role] ?? [],
  }).allowed;
}

/** Lo que las listas hardcodeadas conceden hoy. */
function legacyAllows(role: string, permission: string): boolean {
  if (role === "ADMIN") return true;
  return (LEGACY_ROLE_LISTS[permission as never] ?? []).includes(role);
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
    expect(ROLE_SEED.ADMIN).toBeUndefined();
  });
});

describe("paridad con las listas hardcodeadas", () => {
  const declaradas = new Map(
    DIVERGENCIAS.map((d) => [`${d.role}|${d.permission}`, d]),
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
});

describe("la divergencia decidida el 2026-08-17", () => {
  it("GERENTE pierde las API keys y no gana nada a cambio", () => {
    expect(seedAllows("GERENTE", "integraciones.gestionar")).toBe(false);
    expect(legacyAllows("GERENTE", "integraciones.gestionar")).toBe(true);
  });

  it("DIRECTOR conserva las API keys: la decisión era solo sobre GERENTE", () => {
    expect(seedAllows("DIRECTOR", "integraciones.gestionar")).toBe(true);
  });

  it("MARKETING conserva los comentarios (PR #12, ya en producción)", () => {
    expect(seedAllows("MARKETING", "comentarios.gestionar")).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/permissions/seed-data.test.ts`
Expected: FAIL — `Failed to load url ./seed-data`

- [ ] **Step 3: Escribir la implementación mínima**

Crear `src/lib/permissions/seed-data.ts`:

```ts
// La semilla de permisos y las diferencias deliberadas respecto a hoy.
// Módulo PURO. Ver spec §8 y §8.1.
import type { Permission } from "./catalog";

/**
 * Quién tiene cada permiso HOY, según las listas hardcodeadas del repo.
 * Es el "antes" contra el que se mide la paridad. ADMIN se omite: es comodín.
 *
 * Verificado contra el código 2026-08-17:
 *  - ADMIN_ROLES            src/server/admin.ts:18, bot-config.ts:8,
 *                           bot-playbook.ts:10, bot-agents.ts:9
 *  - PASSWORD_RESET_ROLES   src/server/admin.ts:26
 *  - COMMENT_RULES_ROLES    src/lib/comments/roles.ts
 */
export const LEGACY_ROLE_LISTS = {
  "usuarios.ver": ["DIRECTOR", "GERENTE"],
  "usuarios.editar": ["DIRECTOR", "GERENTE"],
  "usuarios.password": ["DIRECTOR"],
  "comisiones.reglas": ["DIRECTOR", "GERENTE"],
  "config.actividad": ["DIRECTOR", "GERENTE"],
  "integraciones.gestionar": ["DIRECTOR", "GERENTE"],
  "bot.configurar": ["DIRECTOR", "GERENTE"],
  "comentarios.gestionar": ["DIRECTOR", "GERENTE", "MARKETING"],
  "permisos.gestionar": [], // no existe hoy
} as const satisfies Record<Permission, readonly string[]>;

/**
 * Diferencias a propósito entre lo de hoy y lo que siembra ROLE_SEED.
 *
 * Existe esta lista porque un test de paridad estricto no admite mejoras:
 * cualquier cambio intencional lo pone en rojo, y la tentación entonces es
 * aflojar el test — que es como se pierde la red entera. Aquí se declaran, con
 * su motivo, y el test comprueba que ocurran Y que no haya ninguna otra.
 */
export const DIVERGENCIAS = [
  {
    role: "GERENTE",
    permission: "integraciones.gestionar",
    antes: true,
    despues: false,
    motivo:
      "Decisión de Luis (2026-08-17): un GERENTE no necesita las API keys, " +
      "que son credenciales de sistemas externos. Comprobado antes de aplicar: " +
      "hay un solo GERENTE (Karla Muñoz, alta 2026-08-11) con cero filas en " +
      "audit_logs, cero actividades y cero contactos. Si resultara equivocado, " +
      "la salida es un override por persona, no revertir la decisión.",
  },
] as const satisfies readonly {
  role: string;
  permission: Permission;
  antes: boolean;
  despues: boolean;
  motivo: string;
}[];

/**
 * Lo que se escribe en role_permissions.
 *
 * ADMIN no aparece: resolvePermission lo deja pasar antes de consultar nada.
 * Los permisos sensibles tampoco: solo se conceden por persona.
 */
export const ROLE_SEED = {
  DIRECTOR: [
    "usuarios.ver",
    "usuarios.editar",
    "comisiones.reglas",
    "config.actividad",
    "integraciones.gestionar",
    "bot.configurar",
    "comentarios.gestionar",
  ],
  GERENTE: [
    "usuarios.ver",
    "usuarios.editar",
    "comisiones.reglas",
    "config.actividad",
    // integraciones.gestionar: retirado a propósito, ver DIVERGENCIAS
    "bot.configurar",
    "comentarios.gestionar",
  ],
  MARKETING: ["comentarios.gestionar"],
} as const satisfies Record<string, readonly Permission[]>;
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/permissions/seed-data.test.ts`
Expected: PASS, 10 tests

Si el test de paridad reporta divergencias no declaradas, **no aflojes el test ni agregues la divergencia a la lista sin pensar**: revisa primero si `ROLE_SEED` o `LEGACY_ROLE_LISTS` tienen un error de transcripción. Ese es el fallo esperado.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions/seed-data.ts src/lib/permissions/seed-data.test.ts
git commit -m "feat(permisos): semilla con paridad verificada y divergencias declaradas

La semilla reproduce las listas hardcodeadas actuales para que nadie gane
ni pierda acceso, con UNA excepción declarada: GERENTE pierde las API
keys (decisión 2026-08-17).

El test de paridad comprueba las dos direcciones — que las divergencias
declaradas ocurran, y que no haya ninguna otra. Sin eso, la primera
mejora intencional pondría el test en rojo y la salida fácil sería
aflojarlo, perdiendo la red completa."
```

---

## Task 4: Los modelos Prisma y el DDL

**Files:**
- Modify: `prisma/schema.prisma` (añadir 2 modelos; añadir relación en `model User`, que empieza en la línea 664)
- Create: `prisma/migrations/manual/2026-08-17_permissions_tables.sql`

**Interfaces:**
- Consumes: nada del código anterior.
- Produces: modelos `RolePermission` y `UserPermissionOverride`, disponibles como `prisma.rolePermission` y `prisma.userPermissionOverride`.

- [ ] **Step 1: Añadir los modelos al schema**

Añadir al final de `prisma/schema.prisma`:

```prisma
// =====================================================================
// MODERADOR DE PERMISOS — ver docs/superpowers/specs/2026-08-17-moderador-permisos-design.md
// =====================================================================

/// Default de permisos por rol. Presencia de la fila = concedido.
/// ADMIN nunca aparece aquí: es comodín en resolvePermission().
/// Los permisos sensibles tampoco: solo se conceden por persona.
model RolePermission {
  id         String   @id @default(uuid())
  role       UserRole
  permission String
  createdAt  DateTime @default(now())

  @@unique([role, permission])
  @@index([role])
  @@map("role_permissions")
  @@schema("propyte_crm")
}

/// Excepción por persona. `granted` de dos estados: true concede aunque su
/// rol no lo tenga, false revoca aunque sí. El false es lo que permite darle
/// un permiso a un rol y quitárselo a una cuenta concreta (p.ej. una pantalla).
model UserPermissionOverride {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  permission String
  granted    Boolean
  /// Por qué. Obligatorio si el permiso es sensible (lo valida el server action).
  reason     String?
  createdAt  DateTime @default(now())

  @@unique([userId, permission])
  @@index([userId])
  @@map("user_permission_overrides")
  @@schema("propyte_crm")
}
```

- [ ] **Step 2: Añadir la relación inversa en `model User`**

Prisma exige el lado inverso o `prisma generate` falla. Dentro de `model User` (empieza en `prisma/schema.prisma:664`), junto a las demás relaciones, añadir:

```prisma
  permissionOverrides UserPermissionOverride[]
```

- [ ] **Step 3: Verificar que el schema es válido y regenerar el cliente**

Run: `npx prisma validate && npx prisma generate`
Expected: `The schema at prisma/schema.prisma is valid` y luego `Generated Prisma Client`

Si `validate` se queja de una relación faltante, es que el Step 2 no se aplicó dentro de `model User`.

- [ ] **Step 4: Escribir el DDL para aplicar a mano**

Crear `prisma/migrations/manual/2026-08-17_permissions_tables.sql`:

```sql
-- Moderador de permisos — fase 0.
-- Este repo aplica el DDL a mano (via MCP de Supabase), no con prisma migrate:
-- solo existe una migración de Prisma, la inicial de marzo.
-- Idempotente a propósito: se puede reejecutar sin romper nada.

CREATE TABLE IF NOT EXISTS propyte_crm.role_permissions (
  id          text PRIMARY KEY,
  role        propyte_crm."UserRole" NOT NULL,
  permission  text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_role_permission_key
  ON propyte_crm.role_permissions (role, permission);
CREATE INDEX IF NOT EXISTS role_permissions_role_idx
  ON propyte_crm.role_permissions (role);

CREATE TABLE IF NOT EXISTS propyte_crm.user_permission_overrides (
  id          text PRIMARY KEY,
  "userId"    text NOT NULL
              REFERENCES propyte_crm.users(id) ON DELETE CASCADE,
  permission  text NOT NULL,
  granted     boolean NOT NULL,
  reason      text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS user_permission_overrides_user_permission_key
  ON propyte_crm.user_permission_overrides ("userId", permission);
CREATE INDEX IF NOT EXISTS user_permission_overrides_user_idx
  ON propyte_crm.user_permission_overrides ("userId");

-- RLS: ambas tablas se leen solo desde el servidor con la conexión de Prisma.
-- Se activa sin políticas; service_role la salta. Mismo patrón que las tablas
-- de intake. Ver feedback_supabase_view_security_invoker_bypassa_rls.
ALTER TABLE propyte_crm.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE propyte_crm.user_permission_overrides ENABLE ROW LEVEL SECURITY;
```

⚠️ **Ojo con dos cosas si adaptas este SQL:**
1. `id` es `text` sin default. Los modelos usan `@default(uuid())`, que Prisma genera **en el cliente**, no en Postgres. Si algún día se inserta por SQL directo, hay que pasar el `id`. Mismo tropiezo que las tablas de intake.
2. El tipo del enum es `propyte_crm."UserRole"` con comillas: Postgres lo creó con mayúsculas.

- [ ] **Step 5: Pedir autorización y aplicar el DDL**

**NO ejecutar sin el texto exacto de Luis.** Pedírselo así:

> Para crear las dos tablas de permisos en producción necesito que respondas con:
> `autorizado: aplicar permissions_tables a prod`

Con la autorización, aplicar vía MCP de Supabase (`apply_migration`, proyecto `oaijxdpevakashxshhvm`, nombre `permissions_tables`) con el contenido del `.sql` de arriba.

Verificar después:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='propyte_crm'
  AND table_name IN ('role_permissions','user_permission_overrides');
```
Expected: 2 filas.

Si Luis no autoriza ahora, **detente aquí y sigue con la Task 5**: el resto del plan no necesita las tablas creadas, porque sus tests mockean Prisma.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/manual/2026-08-17_permissions_tables.sql
git commit -m "feat(permisos): modelos RolePermission y UserPermissionOverride

DDL en prisma/migrations/manual/ porque este repo aplica el esquema a
mano vía Supabase, no con prisma migrate.

El id es text sin default en Postgres: el uuid lo genera Prisma en el
cliente. Quien inserte por SQL directo debe pasarlo."
```

---

## Task 5: `can()` — sesión, base y caché

**Files:**
- Create: `src/lib/permissions/can.ts`
- Test: `src/lib/permissions/can.test.ts`

**Interfaces:**
- Consumes: `resolvePermission`, `PermissionDecision` de `./resolve`; `Permission` de `./catalog`; `prisma` de `@/lib/db`.
- Produces:
  - `can(user: { id: string; role: string } | null | undefined, permission: Permission): Promise<boolean>`
  - `explain(user, permission): Promise<PermissionDecision>` — igual que `can` pero devuelve también el `source`; lo usará la vista de Persona
  - `invalidatePermissionCache(userId?: string): void` — sin argumento, limpia todo

**Diseño del caché.** Clave `${userId}|${permission}`, TTL 30 s, `Map` en memoria del proceso. No es un caché distribuido y no hace falta que lo sea: si hay varios procesos, cada uno converge en 30 s. Lo que **no** se hace es meter los permisos en el JWT — ver spec §5.1: en el token, quitar un permiso no surtiría efecto hasta que la persona cerrara sesión, y el moderador se sentiría roto.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/permissions/can.test.ts`:

```ts
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
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/permissions/can.test.ts`
Expected: FAIL — `Failed to load url ./can`

- [ ] **Step 3: Escribir la implementación mínima**

Crear `src/lib/permissions/can.ts`:

```ts
// can(): la puerta de entrada al moderador de permisos.
//
// Los permisos se leen de la BASE en cada petición, nunca del JWT. En el token
// de NextAuth, quitarle un permiso a alguien no surtiría efecto hasta que
// cerrara sesión: moverías un checkbox, no pasaría nada, y pensarías que el
// moderador está roto. El costo es una consulta extra, mitigada con el caché
// de abajo. Ver spec §5.1.
import prisma from "@/lib/db";
import type { Permission } from "./catalog";
import { resolvePermission, type PermissionDecision } from "./resolve";

const TTL_MS = 30_000;

interface CacheEntry {
  decision: PermissionDecision;
  expiresAt: number;
}

/** Caché por proceso. Con varios procesos, cada uno converge en un TTL. */
const cache = new Map<string, CacheEntry>();

const DENEGADO: PermissionDecision = { allowed: false, source: "denegado" };

export function invalidatePermissionCache(userId?: string): void {
  if (!userId) {
    cache.clear();
    return;
  }
  const prefijo = `${userId}|`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefijo)) cache.delete(key);
  }
}

export interface PermissionUser {
  id: string;
  role: string;
}

/** Igual que can(), pero devuelve también de dónde sale la decisión. */
export async function explain(
  user: PermissionUser | null | undefined,
  permission: Permission,
): Promise<PermissionDecision> {
  if (!user) return DENEGADO;

  // Antes del caché y de la base: ninguna combinación de checkboxes ni una
  // base caída puede dejar a un ADMIN fuera de su propio CRM.
  if (user.role === "ADMIN") return { allowed: true, source: "admin-comodin" };

  const key = `${user.id}|${permission}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.decision;

  let decision: PermissionDecision;
  try {
    const [rolePermissions, override] = await Promise.all([
      prisma.rolePermission.findMany({
        where: { role: user.role as never },
        select: { permission: true },
      }),
      prisma.userPermissionOverride.findUnique({
        where: { userId_permission: { userId: user.id, permission } },
        select: { granted: true },
      }),
    ]);

    decision = resolvePermission({
      role: user.role,
      permission,
      rolePermissions: rolePermissions.map((r) => r.permission),
      override,
    });
  } catch (error) {
    // Fail-closed, y SIN cachear: un corte momentáneo no debe dejar a nadie
    // bloqueado 30 segundos más de lo necesario.
    console.error("[permisos] fallo al resolver, denegando:", error);
    return DENEGADO;
  }

  cache.set(key, { decision, expiresAt: Date.now() + TTL_MS });
  return decision;
}

/** ¿Puede esta persona hacer esto? Fail-closed ante cualquier duda. */
export async function can(
  user: PermissionUser | null | undefined,
  permission: Permission,
): Promise<boolean> {
  return (await explain(user, permission)).allowed;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/permissions/can.test.ts`
Expected: PASS, 16 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions/can.ts src/lib/permissions/can.test.ts
git commit -m "feat(permisos): can() lee de la base por petición, no del JWT

En el token de NextAuth, quitar un permiso no surtiría efecto hasta que
la persona cerrara sesión — moverías un checkbox, no pasaría nada, y
pensarías que el moderador está roto. Se paga con una consulta extra,
mitigada con un caché de 30 s con invalidación explícita.

Los fallos de base NO se cachean: un corte momentáneo no debe dejar a
nadie bloqueado medio minuto de más."
```

---

## Task 6: El script de semilla

**Files:**
- Create: `scripts/seed-permissions.ts`
- Modify: `package.json` (añadir script `seed:permissions`)

**Interfaces:**
- Consumes: `ROLE_SEED` de `@/lib/permissions/seed-data`; `isSensitive` de `@/lib/permissions/catalog`.
- Produces: comando `npm run seed:permissions`.

Sigue el patrón de `scripts/seed-admin-users.ts`, que ya existe y se corre con `tsx`.

- [ ] **Step 1: Escribir el script**

Crear `scripts/seed-permissions.ts`:

```ts
// Siembra role_permissions desde ROLE_SEED. Idempotente: se puede correr
// las veces que haga falta.
//
// Correr con: npm run seed:permissions
import { PrismaClient } from "@prisma/client";
import { ROLE_SEED } from "../src/lib/permissions/seed-data";
import { isSensitive } from "../src/lib/permissions/catalog";

const prisma = new PrismaClient();

async function main() {
  let creados = 0;
  let yaEstaban = 0;

  for (const [role, permisos] of Object.entries(ROLE_SEED)) {
    for (const permission of permisos) {
      // Cinturón además del test: un sensible en la semilla sería un agujero
      // silencioso, así que el script se niega en vez de escribirlo.
      if (isSensitive(permission)) {
        throw new Error(
          `ABORTADO: ${permission} es sensible y no puede sembrarse a un rol (${role}). ` +
            `Los sensibles solo se conceden por persona.`,
        );
      }

      const existente = await prisma.rolePermission.findUnique({
        where: { role_permission: { role: role as never, permission } },
        select: { id: true },
      });

      if (existente) {
        yaEstaban++;
        continue;
      }

      await prisma.rolePermission.create({
        data: { role: role as never, permission },
      });
      creados++;
      console.log(`  + ${role} → ${permission}`);
    }
  }

  console.log(`\nSemilla lista: ${creados} creados, ${yaEstaban} ya existían.`);

  // Lo que la semilla NO hace, dicho en voz alta para que nadie lo asuma:
  console.log(
    "\nRecordatorio: ADMIN no se siembra (es comodín) y los permisos " +
      "sensibles tampoco (solo por persona). Ninguna superficie del CRM " +
      "consulta can() todavía: esto no cambia el comportamiento de nada.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Añadir el script a package.json**

Junto a `"seed:admins"`, añadir:

```json
    "seed:permissions": "tsx scripts/seed-permissions.ts",
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin salida, exit 0

Si `prisma.rolePermission` no existe como tipo, falta correr `npx prisma generate` (Task 4, Step 3).

- [ ] **Step 4: Correr la semilla — solo si el DDL se aplicó**

Si la Task 4 Step 5 quedó sin autorización, **salta este paso** y anótalo como pendiente.

Run: `npm run seed:permissions`
Expected: **14 filas** creadas la primera vez — 7 de DIRECTOR + 6 de GERENTE + 1 de MARKETING — y `0 creados, 14 ya existían` al reejecutarlo.

Verificar en base:

```sql
SELECT role, count(*) FROM propyte_crm.role_permissions GROUP BY role ORDER BY role;
```
Expected: `DIRECTOR 7`, `GERENTE 6`, `MARKETING 1`. Ningún `ADMIN`.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-permissions.ts package.json
git commit -m "feat(permisos): script idempotente de semilla

Se niega a sembrar un permiso sensible aunque ROLE_SEED lo trajera: el
test ya lo cubre, pero un agujero de permisos merece cinturón y tirantes.

Avisa al terminar que nada consulta can() todavía, para que nadie asuma
que la semilla cambió algún comportamiento."
```

---

## Task 7: Verificación completa de la fase

**Files:**
- Ninguno nuevo. Es la puerta de calidad antes de dar la fase por cerrada.

- [ ] **Step 1: Suite completa**

Run: `npx vitest run`
Expected: todo verde. La línea base antes de esta fase era **1511 pasando en 175 archivos**; deben sumarse **44 tests nuevos en 4 archivos** (catalog 6, resolve 10, seed-data 11, can 17), es decir **1555 en 179**. Ni uno solo de los existentes debe cambiar de estado.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, sin salida.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

Los mensajes `Dynamic server usage` de `/api/commissions`, `/api/dashboard`, `/api/users` y `/api/units` son ruido preexistente del análisis estático, no fallos.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: exactamente 2 advertencias preexistentes, en `src/components/contacts/contact-detail.tsx` y `src/components/quotes/payment-plan-form.tsx`. **Cero** en archivos de `src/lib/permissions/`.

- [ ] **Step 5: Comprobar que nadie consume `can()` todavía**

Run: `grep -rn "from \"@/lib/permissions/can\"\|from \"./can\"" src/ --include=*.ts --include=*.tsx`
Expected: **solo** `src/lib/permissions/can.test.ts`.

Si aparece cualquier otro archivo, alguien empezó la fase 1 dentro de la fase 0. El valor de esta fase es ser desplegable sin cambiar comportamiento; si hay un consumidor, esa propiedad se perdió.

- [ ] **Step 6: Commit final y push**

```bash
git add -A
git commit -m "chore(permisos): fase 0 completa — cimientos sin consumidores

Catálogo, resolución pura, semilla con paridad verificada, tablas y
can() con caché. Ninguna superficie lo consulta: esta fase se puede
desplegar sin que cambie el comportamiento de nada.

Siguiente: fase 1, migrar las pestañas de /admin y /admin/comentarios."
git push -u origin feat/permisos-fase0
```

---

## Auto-revisión del plan

**Cobertura del spec.** §4.1 catálogo → Task 1. §4.2 `role_permissions` y §4.3 `user_permission_overrides` → Task 4. §5 `can()` y §5.1 base-no-JWT → Task 5. §8 semilla y §8.1 divergencias → Tasks 3 y 6. §9 fail-closed, no-lockout y sensibles → Tasks 1, 2, 3, 5, 6. §10 pruebas → repartidas por tarea, más la Task 7.

**Fuera de esta fase, a propósito:** §6 la pantalla del moderador (fase 2), §7 auditoría de cambios de permisos (nace con la pantalla, en fase 2 — en fase 0 no hay quién cambie permisos desde la UI), §2/§3 el eje de alcance de datos (nunca), §12.1 el override de `pantallapdc@` (fase 1: crearlo antes de que algo consulte `can()` no tendría efecto y quedaría huérfano).

**Consistencia de tipos.** `resolvePermission` recibe `override?: {granted: boolean} | null` y `can` le pasa el resultado de `findUnique` con `select: {granted: true}` — encaja. `PermissionDecision` se define en `resolve.ts` y se reexporta por uso en `can.ts`. `ROLE_SEED` está tipado `Record<string, readonly Permission[]>`, y el script lo recorre con `Object.entries`, que da `string` — de ahí el `as never` en las llamadas a Prisma, igual que hace el resto del repo con los enums.

**Un cabo que el ejecutor debe atar:** el conteo exacto de filas de la semilla en la Task 6 Step 4 está calculado a mano (14). Contar contra `ROLE_SEED` antes de dar por buena la verificación.

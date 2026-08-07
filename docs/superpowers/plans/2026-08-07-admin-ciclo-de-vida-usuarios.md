# Ciclo de vida de usuarios en Admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a `/admin?tab=users` el ciclo de vida completo del usuario — estado a 3 valores, soft delete con restauración, cambio de contraseña por administrador y reasignación de la cartera de un usuario a otro.

**Architecture:** Se agrega la columna `status` (`UserStatus`) a `users` y se mantiene `isActive` como su espejo, para no tocar los seis gates de login/ruteo que ya lo aplican en producción. Todas las acciones nuevas viven en un módulo propio (`src/server/users-lifecycle.ts`) con los guards en `src/lib/users/lifecycle-guards.ts` y la tabla de scopes de activos en `src/lib/users/asset-scopes.ts`, que es el único lugar donde se define qué se cuenta y qué se mueve — así el conteo del diálogo y el movimiento real no pueden divergir.

**Tech Stack:** Next.js 14 (App Router, server actions), Prisma + Postgres/Supabase (schema `propyte_crm`), bcryptjs, Zod, vitest, shadcn/ui (dialog, dropdown-menu, select).

**Spec:** [`docs/superpowers/specs/2026-08-07-admin-ciclo-de-vida-usuarios-design.md`](../specs/2026-08-07-admin-ciclo-de-vida-usuarios-design.md)

**Rama:** `feat/admin-user-lifecycle` (ya creada desde `main` @ `ef39c69`).

**Desviación del spec, decidida al planear:** el spec pedía chunks de 50 para la reasignación. Se usa un solo `updateMany` por scope: es UNA sentencia `UPDATE` en Postgres, no N escrituras, así que trocearla no reduce la carga — la parte en lotes solo aplicaba al patrón de meta-leads, que hacía updates individuales. Un `updateMany` por scope dentro de una `$transaction` es además atómico, que es lo que la reasignación necesita.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `prisma/migrations-manual/2026-08-07-admin-user-lifecycle.sql` | Migración additiva. **No se aplica desde el código** — la ejecuta Luis. |
| `prisma/schema.prisma` | Enum `UserStatus` + 6 campos nuevos en `User`. |
| `src/lib/users/asset-scopes.ts` | Tabla de los 6 scopes: etiqueta, cómo se cuenta, cómo se mueve. Única fuente de verdad. |
| `src/lib/users/lifecycle-guards.ts` | `assertNotSelf`, `assertNotLastAdmin`, `assertNoDependents`, `assertValidTarget`. |
| `src/server/users-lifecycle.ts` | Server actions: `setUserStatus`, `adminResetPassword`, `softDeleteUser`, `restoreUser`, `getUserAssetCounts`, `reassignUserAssets`. |
| `src/server/admin.ts` | Se le quita `deactivateUser` y la rama `isActive` de `updateUser`; `getUsers` gana `status`, `deletedAt` y conteos. |
| `src/components/admin/user-status-dialog.tsx` | Diálogo de cambio de estado (con motivo obligatorio si es Suspendido). |
| `src/components/admin/password-reset-dialog.tsx` | Diálogo de contraseña; la muestra una sola vez. |
| `src/components/admin/reassign-assets-dialog.tsx` | Diálogo de reasignación con conteos reales por scope. |
| `src/components/admin/admin-content.tsx` | Tabla: badge de 3 estados, columna Activos, filtro de estado, toggle "Ver eliminados", menú `⋯`. |
| `src/lib/auth/options.ts` + 3 rutas de `api/auth/` | Añaden `deletedAt: null` a su gate. |

---

## Task 1: Migración y schema

**Files:**
- Create: `prisma/migrations-manual/2026-08-07-admin-user-lifecycle.sql`
- Modify: `prisma/schema.prisma` (enum nuevo + `model User`)

- [ ] **Step 1: Escribir el SQL de la migración**

Crear `prisma/migrations-manual/2026-08-07-admin-user-lifecycle.sql`:

```sql
-- Ciclo de vida de usuarios: estado a 3 valores + metadatos de suspensión y contraseña.
-- Additiva: no borra ni renombra nada. Los identificadores van en camelCase
-- entrecomillado porque el schema de Prisma no usa @map en las columnas de User.

CREATE TYPE propyte_crm."UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

ALTER TABLE propyte_crm.users
  ADD COLUMN "status"            propyte_crm."UserStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "suspendedAt"       timestamptz,
  ADD COLUMN "suspensionReason"  text,
  ADD COLUMN "statusChangedById" uuid,
  ADD COLUMN "statusChangedAt"   timestamptz,
  ADD COLUMN "passwordChangedAt" timestamptz;

ALTER TABLE propyte_crm.users
  ADD CONSTRAINT "users_statusChangedById_fkey"
  FOREIGN KEY ("statusChangedById") REFERENCES propyte_crm.users("id");

-- Backfill: lo que hoy está desactivado es una baja, no una suspensión.
UPDATE propyte_crm.users SET "status" = 'INACTIVE' WHERE "isActive" = false;

CREATE INDEX "users_status_idx" ON propyte_crm.users ("status");
```

- [ ] **Step 2: Agregar el enum al schema de Prisma**

En `prisma/schema.prisma`, junto a los demás enums (por ejemplo después de `enum AuditAction`):

```prisma
enum UserStatus {
  ACTIVE
  SUSPENDED
  INACTIVE

  @@schema("propyte_crm")
}
```

- [ ] **Step 3: Agregar los campos a `model User`**

En `model User`, justo después de la línea `isActive      Boolean     @default(true)`:

```prisma
  status            UserStatus @default(ACTIVE)
  suspendedAt       DateTime?
  suspensionReason  String?
  statusChangedById String?
  statusChangedBy   User?      @relation("UserStatusChanges", fields: [statusChangedById], references: [id])
  statusChangesMade User[]     @relation("UserStatusChanges")
  statusChangedAt   DateTime?
  passwordChangedAt DateTime?
```

Y al final del modelo, junto a `@@map("users")`, agregar el índice para que coincida con el del SQL:

```prisma
  @@index([status])
```

- [ ] **Step 4: Regenerar el cliente y verificar que tipa**

```bash
npx prisma generate
npx tsc --noEmit
```

Esperado: `prisma generate` termina sin error y `tsc` no reporta nada nuevo. `prisma generate` lee el archivo `.prisma`, no la base — funciona aunque la migración todavía no esté aplicada.

**Sin `--no-engine`.** Ese flag genera el cliente en modo Accelerate y exige una `DATABASE_URL` que empiece con `prisma://`; con la URL normal del proyecto, TODA query lanza `Error validating datasource db: the URL must start with the protocol prisma://`. En este CRM esa excepción cae dentro del `authorize()` de NextAuth y sale como un 401 "Credenciales inválidas" — parece contraseña mala y en realidad no corre ninguna query. Si la DLL del engine está bloqueada en Windows, para el dev server y vuelve a generar; no uses el flag.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations-manual/2026-08-07-admin-user-lifecycle.sql
git commit -m "feat(users): estado a 3 valores en el schema (migracion sin aplicar)"
```

---

## Task 2: Tabla de scopes de activos

**Files:**
- Create: `src/lib/users/asset-scopes.ts`
- Test: `src/lib/users/asset-scopes.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/users/asset-scopes.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ASSET_SCOPES, ASSET_SCOPE_KEYS } from "./asset-scopes";

// Cliente falso: cada modelo registra con qué argumentos lo llamaron.
function fakeTx() {
  const calls: Record<string, unknown[]> = {};
  const model = (name: string) => ({
    count: vi.fn(async (args: unknown) => {
      calls[`${name}.count`] = [args];
      return 7;
    }),
    updateMany: vi.fn(async (args: unknown) => {
      calls[`${name}.updateMany`] = [args];
      return { count: 3 };
    }),
  });
  return {
    calls,
    tx: {
      contact: model("contact"),
      deal: model("deal"),
      conversation: model("conversation"),
      unit: model("unit"),
      walkIn: model("walkIn"),
      quote: model("quote"),
    },
  };
}

describe("ASSET_SCOPES", () => {
  it("expone exactamente los 6 scopes acordados", () => {
    expect(ASSET_SCOPE_KEYS).toEqual([
      "contacts",
      "deals",
      "conversations",
      "units",
      "walkins",
      "quotes",
    ]);
  });

  it("cuenta contactos vivos del usuario", async () => {
    const { tx, calls } = fakeTx();
    const n = await ASSET_SCOPES.contacts.count(tx as never, "u1");
    expect(n).toBe(7);
    expect(calls["contact.count"][0]).toEqual({
      where: { assignedToId: "u1", deletedAt: null },
    });
  });

  it("mueve contactos vivos de un usuario a otro", async () => {
    const { tx, calls } = fakeTx();
    const n = await ASSET_SCOPES.contacts.move(tx as never, "u1", "u2");
    expect(n).toBe(3);
    expect(calls["contact.updateMany"][0]).toEqual({
      where: { assignedToId: "u1", deletedAt: null },
      data: { assignedToId: "u2" },
    });
  });

  it("las conversaciones no filtran deletedAt: el modelo no tiene esa columna", async () => {
    const { tx, calls } = fakeTx();
    await ASSET_SCOPES.conversations.move(tx as never, "u1", "u2");
    expect(calls["conversation.updateMany"][0]).toEqual({
      where: { controlledById: "u1" },
      data: { controlledById: "u2" },
    });
  });

  it("walk-ins mueve al asesor asignado y NO toca hostessId", async () => {
    const { tx, calls } = fakeTx();
    await ASSET_SCOPES.walkins.move(tx as never, "u1", "u2");
    const args = calls["walkIn.updateMany"][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(args.where).toEqual({ assignedAdvisorId: "u1", deletedAt: null });
    expect(args.data).toEqual({ assignedAdvisorId: "u2" });
    expect(Object.keys(args.data)).not.toContain("hostessId");
    expect(Object.keys(args.where)).not.toContain("hostessId");
  });

  it("unidades mueve reservedByUserId y NO toca reservedByContactId", async () => {
    const { tx, calls } = fakeTx();
    await ASSET_SCOPES.units.move(tx as never, "u1", "u2");
    const args = calls["unit.updateMany"][0] as { data: Record<string, unknown> };
    expect(args.data).toEqual({ reservedByUserId: "u2" });
    expect(Object.keys(args.data)).not.toContain("reservedByContactId");
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npx vitest run src/lib/users/asset-scopes.test.ts
```

Esperado: FAIL — `Failed to resolve import "./asset-scopes"`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `src/lib/users/asset-scopes.ts`:

```ts
// Única fuente de verdad de qué activos de un usuario se cuentan y se mueven.
// El diálogo de reasignación cuenta con `count` y el movimiento usa `move`:
// si un scope se agrega aquí, aparece en los dos lados o en ninguno.
import type { Prisma } from "@prisma/client";

export type AssetScope =
  | "contacts"
  | "deals"
  | "conversations"
  | "units"
  | "walkins"
  | "quotes";

type Tx = Prisma.TransactionClient;

interface ScopeDef {
  /** Etiqueta en español para el diálogo. */
  label: string;
  /** Cuántos activos vivos de este scope tiene el usuario. */
  count: (tx: Tx, userId: string) => Promise<number>;
  /** Mueve los activos de `fromId` a `toId`. Devuelve cuántas filas cambió. */
  move: (tx: Tx, fromId: string, toId: string) => Promise<number>;
}

export const ASSET_SCOPES: Record<AssetScope, ScopeDef> = {
  contacts: {
    label: "Contactos",
    count: (tx, userId) =>
      tx.contact.count({ where: { assignedToId: userId, deletedAt: null } }),
    move: async (tx, fromId, toId) =>
      (
        await tx.contact.updateMany({
          where: { assignedToId: fromId, deletedAt: null },
          data: { assignedToId: toId },
        })
      ).count,
  },
  deals: {
    label: "Negocios",
    count: (tx, userId) =>
      tx.deal.count({ where: { assignedToId: userId, deletedAt: null } }),
    move: async (tx, fromId, toId) =>
      (
        await tx.deal.updateMany({
          where: { assignedToId: fromId, deletedAt: null },
          data: { assignedToId: toId },
        })
      ).count,
  },
  conversations: {
    // Conversation no tiene deletedAt. Mover controlledById libera además el
    // lock de takeover del inbox: el hilo no queda tomado por una cuenta muerta.
    label: "Conversaciones del inbox",
    count: (tx, userId) =>
      tx.conversation.count({ where: { controlledById: userId } }),
    move: async (tx, fromId, toId) =>
      (
        await tx.conversation.updateMany({
          where: { controlledById: fromId },
          data: { controlledById: toId },
        })
      ).count,
  },
  units: {
    label: "Unidades reservadas",
    count: (tx, userId) =>
      tx.unit.count({ where: { reservedByUserId: userId, deletedAt: null } }),
    move: async (tx, fromId, toId) =>
      (
        await tx.unit.updateMany({
          where: { reservedByUserId: fromId, deletedAt: null },
          data: { reservedByUserId: toId },
        })
      ).count,
  },
  walkins: {
    // Solo el asesor asignado. `hostessId` es el registro histórico de quién
    // recibió a la persona en el showroom, no una asignación de trabajo.
    label: "Walk-ins asignados",
    count: (tx, userId) =>
      tx.walkIn.count({
        where: { assignedAdvisorId: userId, deletedAt: null },
      }),
    move: async (tx, fromId, toId) =>
      (
        await tx.walkIn.updateMany({
          where: { assignedAdvisorId: fromId, deletedAt: null },
          data: { assignedAdvisorId: toId },
        })
      ).count,
  },
  quotes: {
    // Mover `createdById` reescribe la autoría. Es el único vínculo de la
    // cotización con un usuario; sin moverlo nadie puede darle seguimiento.
    // El AuditLog guarda el fromId original para que siga siendo reconstruible.
    label: "Cotizaciones",
    count: (tx, userId) =>
      tx.quote.count({ where: { createdById: userId, deletedAt: null } }),
    move: async (tx, fromId, toId) =>
      (
        await tx.quote.updateMany({
          where: { createdById: fromId, deletedAt: null },
          data: { createdById: toId },
        })
      ).count,
  },
};

export const ASSET_SCOPE_KEYS = Object.keys(ASSET_SCOPES) as AssetScope[];
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
npx vitest run src/lib/users/asset-scopes.test.ts
```

Esperado: PASS, 6 tests.

- [ ] **Step 5: Verificar que el test muerde**

Cambiar temporalmente en `asset-scopes.ts` el `move` de `walkins` para que también escriba `hostessId: toId`. Correr el test de nuevo: debe FALLAR en "walk-ins mueve al asesor asignado y NO toca hostessId". Revertir el cambio y confirmar que vuelve a pasar.

- [ ] **Step 6: Commit**

```bash
git add src/lib/users/asset-scopes.ts src/lib/users/asset-scopes.test.ts
git commit -m "feat(users): tabla de scopes de activos reasignables"
```

---

## Task 3: Guards del ciclo de vida

**Files:**
- Create: `src/lib/users/lifecycle-guards.ts`
- Test: `src/lib/users/lifecycle-guards.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/users/lifecycle-guards.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  assertNotSelf,
  assertNotLastAdmin,
  assertNoDependents,
  assertValidTarget,
} from "./lifecycle-guards";

function txWith(overrides: {
  target?: Record<string, unknown> | null;
  adminCount?: number;
  members?: Array<{ name: string }>;
  teams?: Array<{ name: string }>;
  territories?: number;
}) {
  return {
    user: {
      findUnique: vi.fn(async () =>
        overrides.target === undefined
          ? { id: "u1", role: "ASESOR_JR", name: "Ana", isActive: true, deletedAt: null }
          : overrides.target,
      ),
      count: vi.fn(async () => overrides.adminCount ?? 3),
      findMany: vi.fn(async () => overrides.members ?? []),
    },
    team: { findMany: vi.fn(async () => overrides.teams ?? []) },
    territoryMember: { count: vi.fn(async () => overrides.territories ?? 0) },
  } as never;
}

describe("assertNotSelf", () => {
  it("rechaza actuar sobre la propia cuenta", () => {
    expect(() => assertNotSelf("u1", "u1")).toThrow(/tu propia cuenta/);
  });

  it("permite actuar sobre otra cuenta", () => {
    expect(() => assertNotSelf("u1", "u2")).not.toThrow();
  });
});

describe("assertNotLastAdmin", () => {
  it("rechaza si es el último ADMIN o DIRECTOR activo", async () => {
    const tx = txWith({ target: { role: "DIRECTOR" }, adminCount: 0 });
    await expect(assertNotLastAdmin(tx, "u1")).rejects.toThrow(
      /sin administradores activos/,
    );
  });

  it("permite si queda otro administrador activo", async () => {
    const tx = txWith({ target: { role: "DIRECTOR" }, adminCount: 1 });
    await expect(assertNotLastAdmin(tx, "u1")).resolves.toBeUndefined();
  });

  it("no aplica a roles que no son administradores", async () => {
    const tx = txWith({ target: { role: "ASESOR_JR" }, adminCount: 0 });
    await expect(assertNotLastAdmin(tx, "u1")).resolves.toBeUndefined();
  });
});

describe("assertNoDependents", () => {
  it("rechaza y nombra a los subordinados", async () => {
    const tx = txWith({ members: [{ name: "Ana" }, { name: "Beto" }] });
    await expect(assertNoDependents(tx, "u1")).rejects.toThrow(/Ana, Beto/);
  });

  it("rechaza y nombra los equipos que lidera", async () => {
    const tx = txWith({ teams: [{ name: "Tulum A" }] });
    await expect(assertNoDependents(tx, "u1")).rejects.toThrow(/Tulum A/);
  });

  it("rechaza si tiene membresías de territorio", async () => {
    const tx = txWith({ territories: 2 });
    await expect(assertNoDependents(tx, "u1")).rejects.toThrow(/territorio/);
  });

  it("permite cuando no tiene nada colgando", async () => {
    await expect(assertNoDependents(txWith({}), "u1")).resolves.toBeUndefined();
  });
});

describe("assertValidTarget (destino de una reasignación)", () => {
  it("rechaza un destino igual al origen", async () => {
    await expect(assertValidTarget(txWith({}), "u1", "u1")).rejects.toThrow(
      /mismo usuario/,
    );
  });

  it("rechaza un destino inexistente", async () => {
    const tx = txWith({ target: null });
    await expect(assertValidTarget(tx, "u1", "u2")).rejects.toThrow(
      /no existe/,
    );
  });

  it("rechaza un destino que no está activo", async () => {
    const tx = txWith({
      target: { id: "u2", name: "Beto", isActive: false, deletedAt: null, plaza: "TULUM" },
    });
    await expect(assertValidTarget(tx, "u1", "u2")).rejects.toThrow(/activo/);
  });

  it("acepta un destino activo", async () => {
    const tx = txWith({
      target: { id: "u2", name: "Beto", isActive: true, deletedAt: null, plaza: "TULUM" },
    });
    await expect(assertValidTarget(tx, "u1", "u2")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npx vitest run src/lib/users/lifecycle-guards.test.ts
```

Esperado: FAIL — `Failed to resolve import "./lifecycle-guards"`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `src/lib/users/lifecycle-guards.ts`:

```ts
// Invariantes del ciclo de vida de usuarios. Se aplican en el servidor:
// la UI oculta las acciones que no corresponden, pero eso no es una defensa.
import type { Prisma, UserRole } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Roles que no pueden desaparecer del sistema. */
const ELEVATED_ROLES: UserRole[] = ["ADMIN", "DIRECTOR"];

/** Nadie se suspende, da de baja, elimina ni se cambia la contraseña a sí mismo. */
export function assertNotSelf(actorId: string, targetId: string): void {
  if (actorId === targetId) {
    throw new Error(
      "No puedes aplicar esta acción sobre tu propia cuenta. Pídele a otro administrador que la haga.",
    );
  }
}

/** El CRM no puede quedarse sin ninguna cuenta ADMIN o DIRECTOR activa. */
export async function assertNotLastAdmin(tx: Tx, targetId: string): Promise<void> {
  const target = await tx.user.findUnique({
    where: { id: targetId },
    select: { role: true },
  });
  if (!target || !ELEVATED_ROLES.includes(target.role)) return;

  const remaining = await tx.user.count({
    where: {
      id: { not: targetId },
      role: { in: ELEVATED_ROLES },
      isActive: true,
      deletedAt: null,
    },
  });
  if (remaining === 0) {
    throw new Error(
      "No puedes dejar el CRM sin administradores activos: es la última cuenta ADMIN o DIRECTOR activa.",
    );
  }
}

/**
 * El traspaso de equipos y territorios quedó fuera de alcance, así que en vez
 * de dejar subordinados colgando de una cuenta muerta y ruteo por territorio
 * apuntando a alguien que no existe, la acción se detiene y dice qué reasignar.
 */
export async function assertNoDependents(tx: Tx, targetId: string): Promise<void> {
  const [members, teams, territories] = await Promise.all([
    tx.user.findMany({
      where: { teamLeaderId: targetId, deletedAt: null },
      select: { name: true },
    }),
    tx.team.findMany({
      where: { leaderId: targetId, deletedAt: null, isActive: true },
      select: { name: true },
    }),
    tx.territoryMember.count({ where: { userId: targetId } }),
  ]);

  if (members.length > 0) {
    throw new Error(
      `Este usuario es Team Leader de ${members.map((m) => m.name).join(", ")}. Reasigna a su equipo a otro líder antes de continuar.`,
    );
  }
  if (teams.length > 0) {
    throw new Error(
      `Este usuario lidera ${teams.map((t) => t.name).join(", ")}. Cambia el líder del equipo antes de continuar.`,
    );
  }
  if (territories > 0) {
    throw new Error(
      "Este usuario es miembro de un territorio. Quítalo del territorio antes de continuar, o el ruteo apuntará a una cuenta inactiva.",
    );
  }
}

/** El destino de una reasignación debe existir, estar activo y no ser el origen. */
export async function assertValidTarget(
  tx: Tx,
  fromId: string,
  toId: string,
): Promise<void> {
  if (fromId === toId) {
    throw new Error("El origen y el destino no pueden ser el mismo usuario.");
  }
  const target = await tx.user.findUnique({
    where: { id: toId },
    select: { id: true, name: true, isActive: true, deletedAt: true },
  });
  if (!target || target.deletedAt) {
    throw new Error("El usuario destino no existe o está eliminado.");
  }
  if (!target.isActive) {
    throw new Error(
      "El usuario destino no está activo. Elige a alguien que pueda trabajar la cartera.",
    );
  }
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
npx vitest run src/lib/users/lifecycle-guards.test.ts
```

Esperado: PASS, 13 tests.

- [ ] **Step 5: Verificar que los tests muerden**

Cambiar `remaining === 0` por `remaining < 0` en `assertNotLastAdmin`. Correr: debe FALLAR "rechaza si es el último ADMIN o DIRECTOR activo". Revertir.

- [ ] **Step 6: Commit**

```bash
git add src/lib/users/lifecycle-guards.ts src/lib/users/lifecycle-guards.test.ts
git commit -m "feat(users): guards del ciclo de vida (self, ultimo admin, dependientes, destino)"
```

---

## Task 4: `setUserStatus` — único escritor del espejo

**Files:**
- Create: `src/server/users-lifecycle.ts`
- Test: `src/server/users-lifecycle.status.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/server/users-lifecycle.status.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

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
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npx vitest run src/server/users-lifecycle.status.test.ts
```

Esperado: FAIL — `Failed to resolve import "./users-lifecycle"`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `src/server/users-lifecycle.ts`:

```ts
// ============================================================
// Server Actions: ciclo de vida de usuarios
// Estado (activo/suspendido/inactivo), contraseña, soft delete y
// reasignación de activos. Separado de admin.ts porque son las acciones
// destructivas y llevan sus propios guards de rol.
// ============================================================

"use server";

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { z } from "zod";
import type { UserStatus } from "@prisma/client";
import {
  assertNotSelf,
  assertNotLastAdmin,
  assertNoDependents,
} from "@/lib/users/lifecycle-guards";

/** Puede ver y suspender. */
const ADMIN_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];
/** Puede cambiar contraseñas y eliminar. */
const ELEVATED_ROLES = ["ADMIN", "DIRECTOR"];

async function requireRole(allowed: string[]) {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");
  if (!allowed.includes(session.user.role)) {
    throw new Error("Acceso denegado: no tienes permiso para esta acción");
  }
  return session;
}

const setUserStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "INACTIVE"]),
  reason: z.string().trim().min(3).optional(),
});

/**
 * ÚNICO escritor de `status` e `isActive` sobre User en todo el código.
 * `isActive` es la derivada `status === 'ACTIVE'` y es lo que aplican el login
 * y el ruteo de leads; si se escribe por otro lado, el espejo se desincroniza.
 */
export async function setUserStatus(
  id: string,
  status: UserStatus,
  reason?: string,
) {
  const session = await requireRole(ADMIN_ROLES);
  const validated = setUserStatusSchema.parse({ status, reason });

  if (validated.status === "SUSPENDED" && !validated.reason) {
    throw new Error("Al suspender hay que registrar un motivo");
  }

  assertNotSelf(session.user.id, id);

  const isActive = validated.status === "ACTIVE";
  const now = new Date();

  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id },
      select: { id: true, name: true, role: true, isActive: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt) throw new Error("Usuario no encontrado");

    // Quitarle el acceso a alguien exige que no deje nada colgando.
    // Devolvérselo, no.
    if (!isActive) {
      await assertNotLastAdmin(tx, id);
      await assertNoDependents(tx, id);
    }

    return tx.user.update({
      where: { id },
      data: {
        status: validated.status,
        isActive,
        suspendedAt: validated.status === "SUSPENDED" ? now : null,
        suspensionReason: validated.status === "SUSPENDED" ? validated.reason : null,
        statusChangedById: session.user.id,
        statusChangedAt: now,
      },
      select: { id: true, name: true, status: true, isActive: true },
    });
  });

  await prisma.auditLog
    .create({
      data: {
        userId: session.user.id,
        action: "UPDATE",
        entity: "User",
        entityId: id,
        changes: { status: validated.status, reason: validated.reason ?? null },
      },
    })
    .catch(() => {});

  return user;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
npx vitest run src/server/users-lifecycle.status.test.ts
```

Esperado: PASS, 12 tests.

- [ ] **Step 5: Verificar que el test muerde**

Cambiar `isActive` en el `data` del update por `isActive: true` fijo. Correr: deben FALLAR los casos de SUSPENDED e INACTIVE. Revertir.

- [ ] **Step 6: Commit**

```bash
git add src/server/users-lifecycle.ts src/server/users-lifecycle.status.test.ts
git commit -m "feat(users): setUserStatus como unico escritor del espejo isActive"
```

---

## Task 5: Cerrar las otras puertas a `isActive`

**Files:**
- Modify: `src/server/admin.ts:59-83` (quitar `isActive` de `updateUserSchema`), `:238-304` (`updateUser`), `:306-324` (borrar `deactivateUser`)
- Test: `src/server/users-lifecycle.mirror.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/server/users-lifecycle.mirror.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// El espejo status↔isActive solo se sostiene si nadie más escribe isActive
// sobre User. Esto es un guardrail estructural, no una prueba de comportamiento:
// si falla, revisa el archivo que nombra — puede ser un falso positivo, pero
// nunca debe pasar inadvertido.
const ALLOWED = [join("src", "server", "users-lifecycle.ts")];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !entry.includes(".test.") ? [full] : [];
  });
}

describe("espejo isActive", () => {
  it("solo users-lifecycle.ts escribe isActive sobre User", () => {
    const offenders = walk("src")
      .filter((f) => !ALLOWED.some((a) => f.endsWith(a)))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        // Cada llamada a prisma/tx .user.update|updateMany y los 300 caracteres
        // siguientes: si ahí aparece isActive, ese archivo escribe el espejo.
        return src
          .split(/\b(?:prisma|tx)\.user\.update(?:Many)?\s*\(/)
          .slice(1)
          .some((chunk) => /isActive/.test(chunk.slice(0, 300)));
      });

    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npx vitest run src/server/users-lifecycle.mirror.test.ts
```

Esperado: FAIL — el arreglo trae `src/server/admin.ts`, porque `updateUser` y `deactivateUser` todavía escriben `isActive`.

- [ ] **Step 3: Quitar `isActive` de `updateUserSchema`**

En `src/server/admin.ts`, borrar la última línea del objeto `updateUserSchema`:

```ts
  isActive: z.boolean().optional(),
```

- [ ] **Step 4: Quitar `isActive` de la firma y del cuerpo de `updateUser`**

En la firma de `updateUser`, borrar `isActive?: boolean;`. En el cuerpo, borrar:

```ts
  if (validated.isActive !== undefined) updateData.isActive = validated.isActive;
```

- [ ] **Step 5: Borrar `deactivateUser`**

Borrar toda la función `deactivateUser` (el bloque de comentario `/** Desactiva un usuario... */` incluido). `setUserStatus(id, "INACTIVE")` la reemplaza.

- [ ] **Step 6: Correr el test y el typecheck**

```bash
npx vitest run src/server/users-lifecycle.mirror.test.ts
npx tsc --noEmit
```

Esperado: el test PASA. `tsc` FALLA en `src/components/admin/admin-content.tsx` porque todavía importa `deactivateUser` — eso se arregla en la Task 11 y es esperado aquí. Anótalo y sigue; no lo silencies.

- [ ] **Step 7: Commit**

```bash
git add src/server/admin.ts src/server/users-lifecycle.mirror.test.ts
git commit -m "refactor(users): isActive solo se escribe desde setUserStatus"
```

---

## Task 6: `adminResetPassword`

**Files:**
- Modify: `src/server/users-lifecycle.ts`
- Test: `src/server/users-lifecycle.password.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/server/users-lifecycle.password.test.ts`:

```ts
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
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npx vitest run src/server/users-lifecycle.password.test.ts
```

Esperado: FAIL — `adminResetPassword is not a function`.

- [ ] **Step 3: Escribir la implementación mínima**

Agregar a `src/server/users-lifecycle.ts` (y sumar `import { hash } from "bcryptjs";` y `import { randomBytes } from "crypto";` arriba):

```ts
const MIN_PASSWORD_LENGTH = 8;
/** Sin caracteres ambiguos (0/O, 1/l/I): esta contraseña se dicta por teléfono. */
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generatePassword(length = 16): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  }
  return out;
}

/**
 * Fija la contraseña de otro usuario y la devuelve en claro UNA sola vez.
 * Nada la persiste sin hashear y no vuelve a estar disponible después.
 */
export async function adminResetPassword(id: string, password?: string) {
  const session = await requireRole(ELEVATED_ROLES);
  assertNotSelf(session.user.id, id);

  const raw = password ?? generatePassword();
  if (raw.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
  }

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) throw new Error("Usuario no encontrado");

  await prisma.user.update({
    where: { id },
    data: { passwordHash: await hash(raw, 12), passwordChangedAt: new Date() },
  });

  await prisma.auditLog
    .create({
      data: {
        userId: session.user.id,
        action: "UPDATE",
        entity: "User",
        entityId: id,
        // El valor nunca entra a la bitácora, solo el hecho.
        changes: { passwordReset: true, targetEmail: existing.email },
      },
    })
    .catch(() => {});

  return { password: raw, user: { id: existing.id, name: existing.name } };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
npx vitest run src/server/users-lifecycle.password.test.ts
```

Esperado: PASS, 8 tests.

- [ ] **Step 5: Verificar que el test muerde**

Cambiar `passwordHash: await hash(raw, 12)` por `passwordHash: raw`. Correr: debe FALLAR "guarda el hash... no el texto plano". Revertir.

- [ ] **Step 6: Commit**

```bash
git add src/server/users-lifecycle.ts src/server/users-lifecycle.password.test.ts
git commit -m "feat(users): cambio de contrasena por administrador, mostrada una vez"
```

---

## Task 7: `getUserAssetCounts` y `reassignUserAssets`

**Files:**
- Modify: `src/server/users-lifecycle.ts`
- Test: `src/server/users-lifecycle.reassign.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/server/users-lifecycle.reassign.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const moved: Record<string, number> = {};
const counted: string[] = [];
const auditCreate = vi.fn();
const userFindUnique = vi.fn();

function model(name: string) {
  return {
    count: vi.fn(async () => {
      counted.push(name);
      return 4;
    }),
    updateMany: vi.fn(async () => {
      moved[name] = (moved[name] ?? 0) + 1;
      return { count: 2 };
    }),
  };
}

const db = {
  contact: model("contact"),
  deal: model("deal"),
  conversation: model("conversation"),
  unit: model("unit"),
  walkIn: model("walkIn"),
  quote: model("quote"),
  user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
  auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
};

vi.mock("@/lib/db", () => ({
  default: { ...db, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db) },
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "actor-1", role: "GERENTE" } }),
}));

import { getUserAssetCounts, reassignUserAssets } from "./users-lifecycle";

beforeEach(() => {
  for (const k of Object.keys(moved)) delete moved[k];
  counted.length = 0;
  auditCreate.mockReset().mockResolvedValue({});
  userFindUnique.mockReset().mockResolvedValue({
    id: "u2", name: "Beto", isActive: true, deletedAt: null,
  });
});

describe("getUserAssetCounts", () => {
  it("devuelve un conteo por cada uno de los 6 scopes", async () => {
    const counts = await getUserAssetCounts("u1");

    expect(Object.keys(counts).sort()).toEqual(
      ["contacts", "conversations", "deals", "quotes", "units", "walkins"].sort(),
    );
    expect(counts.contacts).toBe(4);
  });
});

describe("reassignUserAssets", () => {
  it("mueve solo los scopes pedidos y ninguno más", async () => {
    await reassignUserAssets("u1", "u2", ["contacts", "deals"]);

    expect(Object.keys(moved).sort()).toEqual(["contact", "deal"]);
  });

  it("devuelve cuántas filas movió por scope", async () => {
    const result = await reassignUserAssets("u1", "u2", ["contacts"]);
    expect(result).toEqual({ contacts: 2 });
  });

  it("rechaza una lista de scopes vacía en vez de no hacer nada en silencio", async () => {
    await expect(reassignUserAssets("u1", "u2", [])).rejects.toThrow(/al menos un/i);
    expect(Object.keys(moved)).toEqual([]);
  });

  it("rechaza un scope que no existe", async () => {
    await expect(
      reassignUserAssets("u1", "u2", ["comisiones" as never]),
    ).rejects.toThrow();
    expect(Object.keys(moved)).toEqual([]);
  });

  it("rechaza si el destino es el mismo usuario", async () => {
    await expect(reassignUserAssets("u1", "u1", ["contacts"])).rejects.toThrow(
      /mismo usuario/,
    );
    expect(Object.keys(moved)).toEqual([]);
  });

  it("rechaza si el destino no está activo", async () => {
    userFindUnique.mockResolvedValue({
      id: "u2", name: "Beto", isActive: false, deletedAt: null,
    });
    await expect(reassignUserAssets("u1", "u2", ["contacts"])).rejects.toThrow(
      /activo/,
    );
    expect(Object.keys(moved)).toEqual([]);
  });

  it("guarda en AuditLog el origen y los conteos movidos", async () => {
    await reassignUserAssets("u1", "u2", ["contacts", "quotes"]);

    const { data } = auditCreate.mock.calls[0][0];
    expect(data.entity).toBe("User");
    expect(data.entityId).toBe("u2");
    expect(data.changes).toMatchObject({
      reassignedFrom: "u1",
      moved: { contacts: 2, quotes: 2 },
    });
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npx vitest run src/server/users-lifecycle.reassign.test.ts
```

Esperado: FAIL — `getUserAssetCounts is not a function`.

- [ ] **Step 3: Escribir la implementación mínima**

Agregar a `src/server/users-lifecycle.ts` (y sumar arriba `import { ASSET_SCOPES, ASSET_SCOPE_KEYS, type AssetScope } from "@/lib/users/asset-scopes";` y `import { assertValidTarget } from "@/lib/users/lifecycle-guards";`):

```ts
const scopeListSchema = z
  .array(z.enum(ASSET_SCOPE_KEYS as [AssetScope, ...AssetScope[]]))
  .min(1, "Selecciona al menos un tipo de activo para mover");

/** Conteo por scope de lo que hoy le cuelga al usuario. Alimenta el diálogo. */
export async function getUserAssetCounts(
  id: string,
): Promise<Record<AssetScope, number>> {
  await requireRole(ADMIN_ROLES);

  const entries = await Promise.all(
    ASSET_SCOPE_KEYS.map(
      async (key) => [key, await ASSET_SCOPES[key].count(prisma, id)] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<AssetScope, number>;
}

/**
 * Mueve los scopes indicados de un usuario a otro. Todo en una transacción:
 * una cartera a medio mover es peor que una sin mover.
 */
export async function reassignUserAssets(
  fromId: string,
  toId: string,
  scopes: AssetScope[],
): Promise<Partial<Record<AssetScope, number>>> {
  const session = await requireRole(ADMIN_ROLES);
  const validated = scopeListSchema.parse(scopes);

  const moved = await prisma.$transaction(async (tx) => {
    await assertValidTarget(tx, fromId, toId);

    const result: Partial<Record<AssetScope, number>> = {};
    for (const key of validated) {
      result[key] = await ASSET_SCOPES[key].move(tx, fromId, toId);
    }
    return result;
  });

  await prisma.auditLog
    .create({
      data: {
        userId: session.user.id,
        action: "UPDATE",
        entity: "User",
        entityId: toId,
        // El fromId queda registrado: es lo que permite reconstruir la autoría
        // original de las cotizaciones, cuyo createdById sí se reescribe.
        changes: { reassignedFrom: fromId, moved },
      },
    })
    .catch(() => {});

  return moved;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
npx vitest run src/server/users-lifecycle.reassign.test.ts
```

Esperado: PASS, 8 tests.

- [ ] **Step 5: Verificar que el test muerde**

Cambiar el `for (const key of validated)` por `for (const key of ASSET_SCOPE_KEYS)`. Correr: debe FALLAR "mueve solo los scopes pedidos y ninguno más". Revertir.

- [ ] **Step 6: Commit**

```bash
git add src/server/users-lifecycle.ts src/server/users-lifecycle.reassign.test.ts
git commit -m "feat(users): conteo y reasignacion de activos entre usuarios"
```

---

## Task 8: `softDeleteUser` y `restoreUser`

**Files:**
- Modify: `src/server/users-lifecycle.ts`
- Test: `src/server/users-lifecycle.delete.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/server/users-lifecycle.delete.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const userUpdate = vi.fn();
const userFindUnique = vi.fn();
const userCount = vi.fn();
const userFindMany = vi.fn();
const teamFindMany = vi.fn();
const territoryMemberCount = vi.fn();
const contactUpdateMany = vi.fn();
const auditCreate = vi.fn();

const db = {
  user: {
    update: (...a: unknown[]) => userUpdate(...a),
    findUnique: (...a: unknown[]) => userFindUnique(...a),
    count: (...a: unknown[]) => userCount(...a),
    findMany: (...a: unknown[]) => userFindMany(...a),
  },
  contact: { updateMany: (...a: unknown[]) => contactUpdateMany(...a) },
  team: { findMany: (...a: unknown[]) => teamFindMany(...a) },
  territoryMember: { count: (...a: unknown[]) => territoryMemberCount(...a) },
  auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
};

vi.mock("@/lib/db", () => ({
  default: { ...db, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db) },
}));

const session = { user: { id: "actor-1", role: "DIRECTOR" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => session }));

import { softDeleteUser, restoreUser } from "./users-lifecycle";

beforeEach(() => {
  for (const m of [
    userUpdate, userFindUnique, userCount, userFindMany,
    teamFindMany, territoryMemberCount, contactUpdateMany, auditCreate,
  ]) m.mockReset();

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
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npx vitest run src/server/users-lifecycle.delete.test.ts
```

Esperado: FAIL — `softDeleteUser is not a function`.

- [ ] **Step 3: Escribir la implementación mínima**

Agregar a `src/server/users-lifecycle.ts`:

```ts
/**
 * Soft delete: el usuario desaparece de la tabla pero conserva historial,
 * comisiones y bitácora. Si le pasan un destino, la cartera se mueve PRIMERO
 * dentro de la misma transacción — si el movimiento falla, el usuario no
 * queda eliminado con los activos colgando.
 */
export async function softDeleteUser(
  id: string,
  opts?: { reassignTo?: string; scopes?: AssetScope[] },
) {
  const session = await requireRole(ELEVATED_ROLES);
  assertNotSelf(session.user.id, id);

  const validatedScopes =
    opts?.reassignTo && opts.scopes ? scopeListSchema.parse(opts.scopes) : [];

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id },
      select: { id: true, name: true, role: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt) throw new Error("Usuario no encontrado");

    await assertNotLastAdmin(tx, id);
    await assertNoDependents(tx, id);

    const moved: Partial<Record<AssetScope, number>> = {};
    if (opts?.reassignTo) {
      await assertValidTarget(tx, id, opts.reassignTo);
      for (const key of validatedScopes) {
        moved[key] = await ASSET_SCOPES[key].move(tx, id, opts.reassignTo);
      }
    }

    const user = await tx.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        status: "INACTIVE",
        statusChangedById: session.user.id,
        statusChangedAt: new Date(),
      },
      select: { id: true, name: true },
    });

    return { user, moved };
  });

  await prisma.auditLog
    .create({
      data: {
        userId: session.user.id,
        action: "DELETE",
        entity: "User",
        entityId: id,
        changes: { reassignedTo: opts?.reassignTo ?? null, moved: result.moved },
      },
    })
    .catch(() => {});

  return result;
}

/**
 * Deshace el soft delete. Devuelve al usuario a INACTIVE, nunca a ACTIVE:
 * restaurar la cuenta y devolverle el acceso son dos decisiones distintas.
 * No reasigna nada de vuelta — lo que se movió, se movió.
 */
export async function restoreUser(id: string) {
  const session = await requireRole(ELEVATED_ROLES);

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!existing) throw new Error("Usuario no encontrado");
  if (!existing.deletedAt) throw new Error("Este usuario no está eliminado");

  const user = await prisma.user.update({
    where: { id },
    data: {
      deletedAt: null,
      status: "INACTIVE",
      isActive: false,
      statusChangedById: session.user.id,
      statusChangedAt: new Date(),
    },
    select: { id: true, name: true, status: true, isActive: true },
  });

  await prisma.auditLog
    .create({
      data: {
        userId: session.user.id,
        action: "UPDATE",
        entity: "User",
        entityId: id,
        changes: { restored: true },
      },
    })
    .catch(() => {});

  return user;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

```bash
npx vitest run src/server/users-lifecycle.delete.test.ts
```

Esperado: PASS, 10 tests.

- [ ] **Step 5: Verificar que el test muerde**

Mover el `tx.user.update` de `softDeleteUser` para que corra ANTES del bucle de reasignación. Correr: debe FALLAR "reasigna antes de eliminar..." y "no elimina si la reasignación falla". Revertir.

- [ ] **Step 6: Commit**

```bash
git add src/server/users-lifecycle.ts src/server/users-lifecycle.delete.test.ts
git commit -m "feat(users): soft delete con reasignacion atomica y restauracion"
```

---

## Task 9: Los gates de autenticación revisan `deletedAt`

**Files:**
- Modify: `src/lib/auth/options.ts:65-87`, `src/app/api/auth/forgot-password/route.ts:26-34`, `src/app/api/auth/request-code/route.ts:30-38`, `src/app/api/auth/reset-password/route.ts:29-36`
- Test: `src/lib/auth/deleted-user-gate.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/auth/deleted-user-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Ninguno de estos cuatro gates revisaba deletedAt. Daba igual mientras nada
// escribiera esa columna; ahora softDeleteUser la escribe, así que un usuario
// eliminado cuyo isActive quedara en true podría entrar. Defensa en
// profundidad: no se confía en que el escritor haga su parte.
const GATES = [
  "src/lib/auth/options.ts",
  "src/app/api/auth/forgot-password/route.ts",
  "src/app/api/auth/request-code/route.ts",
  "src/app/api/auth/reset-password/route.ts",
];

describe("gates de autenticación", () => {
  it.each(GATES)("%s selecciona deletedAt y lo rechaza", (path) => {
    const src = readFileSync(path, "utf8");
    expect(src).toMatch(/deletedAt:\s*true/);
    expect(src).toMatch(/\.deletedAt/);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npx vitest run src/lib/auth/deleted-user-gate.test.ts
```

Esperado: FAIL en los 4 casos.

- [ ] **Step 3: Arreglar `src/lib/auth/options.ts`**

En el `select` de `authorize` (después de `isActive: true,`) agregar:

```ts
            deletedAt: true,
```

Y cambiar el gate:

```ts
        if (!user.isActive || user.deletedAt) {
          throw new Error("Cuenta desactivada. Contacta al administrador.");
        }
```

- [ ] **Step 4: Arreglar las 3 rutas de `api/auth/`**

En cada una de `forgot-password/route.ts`, `request-code/route.ts` y `reset-password/route.ts`, agregar `deletedAt: true` al `select` y cambiar la condición `if (!user || !user.isActive)` por:

```ts
    if (!user || !user.isActive || user.deletedAt) {
```

El cuerpo del `if` no cambia en ninguna de las tres.

- [ ] **Step 5: Correr el test y el typecheck**

```bash
npx vitest run src/lib/auth/deleted-user-gate.test.ts
npx tsc --noEmit
```

Esperado: el test PASA (4 casos). `tsc` sigue fallando solo por `deactivateUser` en `admin-content.tsx` (Task 11).

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/options.ts src/app/api/auth/forgot-password/route.ts src/app/api/auth/request-code/route.ts src/app/api/auth/reset-password/route.ts src/lib/auth/deleted-user-gate.test.ts
git commit -m "fix(auth): un usuario eliminado no pasa ninguno de los cuatro gates"
```

---

## Task 10: `getUsers` expone estado, eliminados y conteo de activos

**Files:**
- Modify: `src/server/admin.ts:144-173` (`getUsers`), `src/app/(dashboard)/admin/page.tsx:38` (llamada)
- Test: `src/server/admin.getUsers.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/server/admin.getUsers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const userFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { user: { findMany: (...a: unknown[]) => userFindMany(...a) } },
}));
vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "actor-1", role: "DIRECTOR" } }),
}));

import { getUsers } from "./admin";

beforeEach(() => {
  userFindMany.mockReset().mockResolvedValue([]);
});

describe("getUsers", () => {
  it("por defecto esconde a los eliminados", async () => {
    await getUsers();
    expect(userFindMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
  });

  it("con includeDeleted trae a todos", async () => {
    await getUsers({ includeDeleted: true });
    expect(userFindMany.mock.calls[0][0].where).toEqual({});
  });

  it("selecciona status, deletedAt y los datos de suspensión", async () => {
    await getUsers();
    const { select } = userFindMany.mock.calls[0][0];
    expect(select.status).toBe(true);
    expect(select.deletedAt).toBe(true);
    expect(select.suspensionReason).toBe(true);
    expect(select.suspendedAt).toBe(true);
  });

  it("cuenta contactos vivos además de negocios, para ver quién tiene cartera", async () => {
    await getUsers();
    const { select } = userFindMany.mock.calls[0][0];
    expect(select._count.select.deals).toEqual({ where: { deletedAt: null } });
    expect(select._count.select.assignedContacts).toEqual({
      where: { deletedAt: null },
    });
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npx vitest run src/server/admin.getUsers.test.ts
```

Esperado: FAIL — `where` es `{ deletedAt: null }` pero `select.status` es `undefined` y `_count.select.deals` es `true`, no un objeto con `where`.

- [ ] **Step 3: Reescribir `getUsers`**

Reemplazar la función completa en `src/server/admin.ts`:

```ts
/**
 * Obtiene los usuarios con su team leader y el conteo de cartera viva.
 * `includeDeleted` alimenta el toggle "Ver eliminados" del panel.
 */
export async function getUsers(opts?: { includeDeleted?: boolean }) {
  await requireAdminRole();

  const users = await prisma.user.findMany({
    where: opts?.includeDeleted ? {} : { deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      plaza: true,
      careerLevel: true,
      isActive: true,
      status: true,
      suspendedAt: true,
      suspensionReason: true,
      deletedAt: true,
      phone: true,
      sedetusNumber: true,
      sedetusExpiry: true,
      teamLeaderId: true,
      teamLeader: {
        select: { id: true, name: true },
      },
      _count: {
        select: {
          deals: { where: { deletedAt: null } },
          assignedContacts: { where: { deletedAt: null } },
        },
      },
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });

  return users;
}
```

- [ ] **Step 4: Pasar el toggle desde la página**

En `src/app/(dashboard)/admin/page.tsx`, cambiar la firma de `searchParams` y la llamada:

```tsx
  searchParams: { tab?: string; deleted?: string };
```

```tsx
    getUsers({ includeDeleted: searchParams?.deleted === "1" }),
```

Y pasar el flag al componente, junto a `initialUsers`:

```tsx
        showDeleted={searchParams?.deleted === "1"}
```

- [ ] **Step 5: Correr el test**

```bash
npx vitest run src/server/admin.getUsers.test.ts
npx tsc --noEmit
```

Esperado: el test PASA (4 casos). `tsc` falla en `admin-content.tsx` por `deactivateUser` y por la prop `showDeleted` que aún no existe — se resuelve en la Task 11.

- [ ] **Step 6: Commit**

```bash
git add src/server/admin.ts "src/app/(dashboard)/admin/page.tsx" src/server/admin.getUsers.test.ts
git commit -m "feat(users): getUsers expone estado, eliminados y conteo de cartera"
```

---

## Task 11: Diálogo de contraseña

**Files:**
- Create: `src/components/admin/password-reset-dialog.tsx`

- [ ] **Step 1: Escribir el componente**

Crear `src/components/admin/password-reset-dialog.tsx`:

```tsx
// Diálogo de cambio de contraseña. La contraseña se muestra UNA sola vez:
// nada la persiste en claro. Por eso este componente NO recarga la página al
// terminar — el reload fue exactamente el bug que se comió la API key recién
// generada en abril (618fa7f), y aquí el fallo sería irreversible.
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, KeyRound } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface PasswordResetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; name: string; email: string } | null;
  /** Devuelve la contraseña en claro para mostrarla una vez. */
  onConfirm: (id: string, password?: string) => Promise<string>;
}

export function PasswordResetDialog({
  open,
  onOpenChange,
  user,
  onConfirm,
}: PasswordResetDialogProps) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [generated, setGenerated] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function close() {
    setPassword("");
    setGenerated(null);
    setSaving(false);
    onOpenChange(false);
  }

  async function submit(useGenerated: boolean) {
    if (!user) return;
    setSaving(true);
    try {
      const result = await onConfirm(user.id, useGenerated ? undefined : password);
      setGenerated(result);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar contraseña</DialogTitle>
          <DialogDescription>
            {user ? `${user.name} — ${user.email}` : ""}
          </DialogDescription>
        </DialogHeader>

        {generated ? (
          <div className="space-y-3">
            <div className="rounded-md border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-900">
              Copia la contraseña ahora. No se vuelve a mostrar: solo se guarda
              su hash.
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-sm">
                {generated}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(generated);
                  toast({ title: "Contraseña copiada" });
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="new-password">Contraseña nueva</Label>
              <Input
                id="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => submit(true)}
              disabled={saving}
            >
              <KeyRound className="mr-2 h-3.5 w-3.5" />
              Generar una segura
            </Button>
          </div>
        )}

        <DialogFooter>
          {generated ? (
            <Button onClick={close}>Ya la copié</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>
                Cancelar
              </Button>
              <Button
                onClick={() => submit(false)}
                disabled={saving || password.length < 8}
              >
                {saving ? "Guardando..." : "Cambiar contraseña"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verificar que compila**

```bash
npx tsc --noEmit 2>&1 | grep password-reset-dialog
```

Esperado: sin salida (el archivo nuevo no aporta errores).

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/password-reset-dialog.tsx
git commit -m "feat(users): dialogo de cambio de contrasena"
```

---

## Task 12: Diálogo de estado

**Files:**
- Create: `src/components/admin/user-status-dialog.tsx`

- [ ] **Step 1: Escribir el componente**

Crear `src/components/admin/user-status-dialog.tsx`:

```tsx
// Cambio de estado de un usuario. Suspender exige motivo: sin él, en tres
// semanas nadie recuerda por qué esa cuenta está detenida.
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

export type UserStatusValue = "ACTIVE" | "SUSPENDED" | "INACTIVE";

const STATUS_OPTIONS: Array<{ value: UserStatusValue; label: string; hint: string }> = [
  { value: "ACTIVE", label: "Activo", hint: "Entra al CRM y recibe leads nuevos." },
  {
    value: "SUSPENDED",
    label: "Suspendido",
    hint: "Temporal: no entra ni recibe leads, conserva su cartera.",
  },
  {
    value: "INACTIVE",
    label: "Inactivo",
    hint: "Baja definitiva. Sigue visible en la tabla y se puede reactivar.",
  },
];

interface UserStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; name: string; status: string } | null;
  onConfirm: (id: string, status: UserStatusValue, reason?: string) => Promise<void>;
}

export function UserStatusDialog({
  open,
  onOpenChange,
  user,
  onConfirm,
}: UserStatusDialogProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<UserStatusValue>("SUSPENDED");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  function close() {
    setReason("");
    setStatus("SUSPENDED");
    setSaving(false);
    onOpenChange(false);
  }

  const needsReason = status === "SUSPENDED";
  const canSubmit = !saving && (!needsReason || reason.trim().length >= 3);

  async function submit() {
    if (!user) return;
    setSaving(true);
    try {
      await onConfirm(user.id, status, needsReason ? reason.trim() : undefined);
      close();
    } catch (error) {
      toast({
        title: "No se pudo cambiar el estado",
        description: error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
      setSaving(false);
    }
  }

  const hint = STATUS_OPTIONS.find((o) => o.value === status)?.hint;

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar estado</DialogTitle>
          <DialogDescription>{user?.name ?? ""}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Estado nuevo</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as UserStatusValue)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          </div>

          {needsReason && (
            <div>
              <Label htmlFor="suspension-reason">Motivo</Label>
              <Input
                id="suspension-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej. incapacidad médica hasta el 20 de agosto"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {saving ? "Guardando..." : "Aplicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verificar que compila**

```bash
npx tsc --noEmit 2>&1 | grep user-status-dialog
```

Esperado: sin salida.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/user-status-dialog.tsx
git commit -m "feat(users): dialogo de cambio de estado con motivo obligatorio"
```

---

## Task 13: Diálogo de reasignación de activos

**Files:**
- Create: `src/components/admin/reassign-assets-dialog.tsx`

- [ ] **Step 1: Escribir el componente**

Crear `src/components/admin/reassign-assets-dialog.tsx`:

```tsx
// Reasignación de la cartera de un usuario a otro. Los conteos vienen del
// servidor al abrir: sin ellos, quien administra no sabe qué está moviendo.
// Un scope en cero se muestra deshabilitado, no oculto — que esté vacío es
// información, no ruido.
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

export const ASSET_SCOPE_LABELS: Record<string, string> = {
  contacts: "Contactos",
  deals: "Negocios",
  conversations: "Conversaciones del inbox",
  units: "Unidades reservadas",
  walkins: "Walk-ins asignados",
  quotes: "Cotizaciones",
};

interface ReassignAssetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; name: string; plaza: string } | null;
  /** Candidatos a destino: solo usuarios activos. */
  candidates: Array<{ id: string; name: string; plaza: string }>;
  loadCounts: (id: string) => Promise<Record<string, number>>;
  onConfirm: (
    fromId: string,
    toId: string,
    scopes: string[],
  ) => Promise<Record<string, number>>;
}

export function ReassignAssetsDialog({
  open,
  onOpenChange,
  user,
  candidates,
  loadCounts,
  onConfirm,
}: ReassignAssetsDialogProps) {
  const { toast } = useToast();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setCounts(null);
    loadCounts(user.id)
      .then((c) => {
        setCounts(c);
        // Precargar los scopes que tienen algo que mover.
        setSelected(Object.keys(c).filter((k) => c[k] > 0));
      })
      .catch((error: unknown) =>
        toast({
          title: "No se pudieron cargar los activos",
          description: error instanceof Error ? error.message : "Error inesperado",
          variant: "destructive",
        }),
      );
  }, [open, user, loadCounts, toast]);

  function close() {
    setCounts(null);
    setSelected([]);
    setTarget("");
    setSaving(false);
    onOpenChange(false);
  }

  function toggle(scope: string) {
    setSelected((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  const targetUser = candidates.find((c) => c.id === target);
  const crossPlaza = Boolean(targetUser && user && targetUser.plaza !== user.plaza);
  const totalToMove = selected.reduce((sum, s) => sum + (counts?.[s] ?? 0), 0);

  async function submit() {
    if (!user || !target) return;
    setSaving(true);
    try {
      const moved = await onConfirm(user.id, target, selected);
      const detail = Object.entries(moved)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${ASSET_SCOPE_LABELS[k] ?? k}`)
        .join(", ");
      toast({
        title: "Activos reasignados",
        description: detail || "No había nada que mover",
      });
      close();
    } catch (error) {
      toast({
        title: "No se pudo reasignar",
        description: error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover activos</DialogTitle>
          <DialogDescription>
            {user ? `Desde ${user.name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Destino</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Elige a quién pasan" />
              </SelectTrigger>
              <SelectContent>
                {candidates
                  .filter((c) => c.id !== user?.id)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {crossPlaza && (
              <p className="mt-1 text-xs text-amber-600">
                El destino es de otra plaza ({targetUser?.plaza}). Se permite,
                pero verifica que sea intencional.
              </p>
            )}
          </div>

          <div>
            <Label>Qué se mueve</Label>
            {counts === null ? (
              <p className="text-sm text-muted-foreground">Contando...</p>
            ) : (
              <div className="mt-1 space-y-1">
                {Object.keys(ASSET_SCOPE_LABELS).map((scope) => {
                  const n = counts[scope] ?? 0;
                  return (
                    <label
                      key={scope}
                      className={`flex items-center gap-2 text-sm ${
                        n === 0 ? "text-muted-foreground" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(scope)}
                        disabled={n === 0}
                        onChange={() => toggle(scope)}
                      />
                      <span className="flex-1">{ASSET_SCOPE_LABELS[scope]}</span>
                      <span className="font-mono text-xs">{n}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {selected.includes("quotes") && (
              <p className="mt-2 text-xs text-amber-600">
                Mover cotizaciones reescribe su autoría. El movimiento queda
                registrado en la bitácora.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={saving || !target || selected.length === 0}
          >
            {saving ? "Moviendo..." : `Mover ${totalToMove} activos`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verificar que compila**

```bash
npx tsc --noEmit 2>&1 | grep reassign-assets-dialog
```

Esperado: sin salida.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/reassign-assets-dialog.tsx
git commit -m "feat(users): dialogo de reasignacion con conteos reales por scope"
```

---

## Task 14: Tabla de usuarios — estado, cartera, filtro y menú de acciones

**Files:**
- Modify: `src/components/admin/admin-content.tsx` (constante de estados :49-53, imports :8-47, interface `UserData` :56-70, props :127-153, handlers :201-249, filtros :349-380, tabla :382-455)

- [ ] **Step 1: Reemplazar la constante de estados**

Reemplazar el bloque `USER_STATUS_CONFIG` completo:

```tsx
// Colores por estado de usuario. `DELETED` es un pseudo-estado de UI: en la
// base es deletedAt, no un valor de status.
const USER_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: "Activo", className: "bg-green-100 text-green-700" },
  SUSPENDED: { label: "Suspendido", className: "bg-amber-100 text-amber-800" },
  INACTIVE: { label: "Inactivo", className: "bg-gray-100 text-gray-700" },
  DELETED: { label: "Eliminado", className: "bg-red-100 text-red-700" },
};
```

- [ ] **Step 2: Actualizar imports**

Cambiar el import de `@/server/admin` (quitar `deactivateUser`):

```tsx
import {
  createUser,
  updateUser,
  createCommissionRule,
  updateCommissionRule,
  deleteCommissionRule,
  updateSystemConfig,
} from "@/server/admin";
```

Y agregar, después del import de `CommentRulesTab`:

```tsx
import {
  setUserStatus,
  adminResetPassword,
  softDeleteUser,
  restoreUser,
  getUserAssetCounts,
  reassignUserAssets,
} from "@/server/users-lifecycle";
import type { AssetScope } from "@/lib/users/asset-scopes";
import { PasswordResetDialog } from "./password-reset-dialog";
import { UserStatusDialog, type UserStatusValue } from "./user-status-dialog";
import { ReassignAssetsDialog } from "./reassign-assets-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
```

- [ ] **Step 3: Extender `UserData` y las props**

En `interface UserData`, agregar después de `isActive: boolean;`:

```tsx
  status: string;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  deletedAt: Date | null;
```

Y cambiar `_count`:

```tsx
  _count: { deals: number; assignedContacts: number };
```

En `interface AdminContentProps`, agregar después de `initialUsers: UserData[];`:

```tsx
  showDeleted?: boolean;
  /** Rol de quien está viendo: decide qué acciones se renderizan. */
  viewerRole: string;
  viewerId: string;
```

Y desestructurarlas en la firma del componente, junto a `initialUsers`:

```tsx
  showDeleted = false,
  viewerRole,
  viewerId,
```

- [ ] **Step 4: Agregar el estado local de los diálogos y el filtro**

Después de `const [plazaFilter, setPlazaFilter] = useState<string>("ALL");`:

```tsx
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Diálogos del ciclo de vida
  const [passwordDialogUser, setPasswordDialogUser] = useState<UserData | null>(null);
  const [statusDialogUser, setStatusDialogUser] = useState<UserData | null>(null);
  const [reassignDialogUser, setReassignDialogUser] = useState<UserData | null>(null);

  // Solo ADMIN y DIRECTOR cambian contraseñas y eliminan.
  const canElevate = ["ADMIN", "DIRECTOR"].includes(viewerRole);
```

- [ ] **Step 5: Extender el filtro de la tabla**

Reemplazar `filteredUsers`:

```tsx
  const filteredUsers = users.filter((u) => {
    if (roleFilter !== "ALL" && u.role !== roleFilter) return false;
    if (plazaFilter !== "ALL" && u.plaza !== plazaFilter) return false;
    if (statusFilter === "DELETED" && !u.deletedAt) return false;
    if (statusFilter !== "ALL" && statusFilter !== "DELETED") {
      if (u.deletedAt || u.status !== statusFilter) return false;
    }
    return true;
  });
```

- [ ] **Step 6: Reemplazar `handleToggleActive` por los handlers nuevos**

Borrar `handleToggleActive` completa y poner en su lugar:

```tsx
  /** Reemplaza el estado de un usuario en la tabla sin recargar la página. */
  function patchUser(id: string, patch: Partial<UserData>) {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  async function handleSetStatus(
    id: string,
    status: UserStatusValue,
    reason?: string,
  ) {
    await setUserStatus(id, status, reason);
    patchUser(id, {
      status,
      isActive: status === "ACTIVE",
      suspensionReason: status === "SUSPENDED" ? (reason ?? null) : null,
      suspendedAt: status === "SUSPENDED" ? new Date() : null,
    });
    toast({ title: `Estado actualizado a ${USER_STATUS_CONFIG[status].label}` });
  }

  async function handleResetPassword(id: string, password?: string) {
    const result = await adminResetPassword(id, password);
    return result.password;
  }

  async function handleReassign(
    fromId: string,
    toId: string,
    scopes: string[],
  ): Promise<Record<string, number>> {
    const moved = await reassignUserAssets(fromId, toId, scopes as AssetScope[]);
    // reassignUserAssets devuelve Partial<Record<AssetScope, number>>: los
    // scopes no pedidos vienen como undefined. El diálogo espera números, así
    // que se normalizan aquí y no allá.
    const clean: Record<string, number> = {};
    for (const [key, value] of Object.entries(moved)) clean[key] = value ?? 0;

    // Los conteos de la fila origen quedan en cero para lo que se movió.
    patchUser(fromId, {
      _count: {
        deals: scopes.includes("deals") ? 0 : (users.find((u) => u.id === fromId)?._count.deals ?? 0),
        assignedContacts: scopes.includes("contacts")
          ? 0
          : (users.find((u) => u.id === fromId)?._count.assignedContacts ?? 0),
      },
    });
    return clean;
  }

  async function handleDelete(user: UserData) {
    const typed = window.prompt(
      `Escribe el nombre del usuario para confirmar la eliminación: ${user.name}`,
    );
    if (typed !== user.name) {
      if (typed !== null) {
        toast({ title: "El nombre no coincide, no se eliminó nada", variant: "destructive" });
      }
      return;
    }
    startTransition(async () => {
      try {
        await softDeleteUser(user.id);
        if (showDeleted) {
          patchUser(user.id, { deletedAt: new Date(), isActive: false, status: "INACTIVE" });
        } else {
          setUsers((prev) => prev.filter((u) => u.id !== user.id));
        }
        toast({ title: "Usuario eliminado" });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  async function handleRestore(user: UserData) {
    startTransition(async () => {
      try {
        await restoreUser(user.id);
        patchUser(user.id, { deletedAt: null, status: "INACTIVE", isActive: false });
        toast({ title: "Usuario restaurado como Inactivo" });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }
```

- [ ] **Step 7: Agregar el filtro de estado y el toggle de eliminados**

Después del `<div className="w-48">` del filtro de plaza, dentro del mismo contenedor `flex gap-4`:

```tsx
                <div className="w-48">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Filtrar por estado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Todos los estados</SelectItem>
                      <SelectItem value="ACTIVE">Activo</SelectItem>
                      <SelectItem value="SUSPENDED">Suspendido</SelectItem>
                      <SelectItem value="INACTIVE">Inactivo</SelectItem>
                      {showDeleted && <SelectItem value="DELETED">Eliminado</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                <Link
                  href={showDeleted ? "/admin?tab=users" : "/admin?tab=users&deleted=1"}
                  className="self-center text-[13px] font-medium hover:underline"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {showDeleted ? "Ocultar eliminados" : "Ver eliminados"}
                </Link>
```

- [ ] **Step 8: Reemplazar las columnas Estado y Acciones**

En el `<thead>`, cambiar la fila de encabezados para agregar Cartera:

```tsx
                      <th className="pb-3 font-medium">Team Leader</th>
                      <th className="pb-3 font-medium">Cartera</th>
                      <th className="pb-3 font-medium">Estado</th>
                      <th className="pb-3 font-medium">Acciones</th>
```

En el `<tbody>`, cambiar la línea del `statusConfig`:

```tsx
                      const statusKey = user.deletedAt ? "DELETED" : user.status;
                      const statusConfig = USER_STATUS_CONFIG[statusKey] ?? USER_STATUS_CONFIG.INACTIVE;
```

Agregar la celda de cartera justo después de la de Team Leader:

```tsx
                          <td className="py-3 text-xs text-muted-foreground">
                            {user._count.assignedContacts} contactos ·{" "}
                            {user._count.deals} negocios
                          </td>
```

Cambiar la celda de estado para que muestre el motivo al pasar el cursor:

```tsx
                          <td className="py-3">
                            <span
                              title={user.suspensionReason ?? undefined}
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusConfig.className}`}
                            >
                              {statusConfig.label}
                            </span>
                          </td>
```

Y reemplazar la celda de acciones completa (el `<div className="flex gap-1">` con los dos botones) por:

```tsx
                          <td className="py-3">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" disabled={isPending}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {user.deletedAt ? (
                                  canElevate && (
                                    <DropdownMenuItem onClick={() => handleRestore(user)}>
                                      Restaurar
                                    </DropdownMenuItem>
                                  )
                                ) : (
                                  <>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setEditingUser(user);
                                        setUserDialogOpen(true);
                                      }}
                                    >
                                      Editar
                                    </DropdownMenuItem>
                                    {canElevate && user.id !== viewerId && (
                                      <DropdownMenuItem
                                        onClick={() => setPasswordDialogUser(user)}
                                      >
                                        Cambiar contraseña
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem
                                      onClick={() => setReassignDialogUser(user)}
                                    >
                                      Mover activos
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    {user.id !== viewerId && (
                                      <DropdownMenuItem
                                        onClick={() => setStatusDialogUser(user)}
                                      >
                                        Cambiar estado
                                      </DropdownMenuItem>
                                    )}
                                    {canElevate && user.id !== viewerId && (
                                      <DropdownMenuItem
                                        className="text-red-600"
                                        onClick={() => handleDelete(user)}
                                      >
                                        Eliminar
                                      </DropdownMenuItem>
                                    )}
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
```

Y en la fila vacía, el `colSpan` pasa de 7 a 8:

```tsx
                        <td colSpan={8} className="py-8 text-center text-muted-foreground">
```

- [ ] **Step 9: Montar los tres diálogos**

Junto a los diálogos existentes al final del componente (donde están `UserFormDialog` y `CommissionRuleDialog`):

```tsx
      <PasswordResetDialog
        open={passwordDialogUser !== null}
        onOpenChange={(v) => !v && setPasswordDialogUser(null)}
        user={passwordDialogUser}
        onConfirm={handleResetPassword}
      />

      <UserStatusDialog
        open={statusDialogUser !== null}
        onOpenChange={(v) => !v && setStatusDialogUser(null)}
        user={statusDialogUser}
        onConfirm={handleSetStatus}
      />

      <ReassignAssetsDialog
        open={reassignDialogUser !== null}
        onOpenChange={(v) => !v && setReassignDialogUser(null)}
        user={reassignDialogUser}
        candidates={users.filter((u) => u.isActive && !u.deletedAt)}
        loadCounts={getUserAssetCounts}
        onConfirm={handleReassign}
      />
```

- [ ] **Step 10: Pasar `viewerRole` y `viewerId` desde la página**

En `src/app/(dashboard)/admin/page.tsx`, junto a `showDeleted`:

```tsx
        viewerRole={session.user.role}
        viewerId={session.user.id}
```

- [ ] **Step 11: Verificar typecheck y build**

```bash
npx tsc --noEmit
npm run build
```

Esperado: ambos limpios. Aquí desaparecen los errores de `deactivateUser` y `showDeleted` que arrastrábamos desde la Task 5.

- [ ] **Step 12: Commit**

```bash
git add src/components/admin/admin-content.tsx "src/app/(dashboard)/admin/page.tsx"
git commit -m "feat(users): tabla con 3 estados, cartera, eliminados y menu de acciones"
```

---

## Task 15: Quitar los `window.location.reload()` de los handlers de usuario

**Files:**
- Modify: `src/components/admin/admin-content.tsx` (`handleCreateUser`, `handleUpdateUser`)

- [ ] **Step 1: Reescribir los dos handlers**

```tsx
  async function handleCreateUser(data: Record<string, unknown>) {
    startTransition(async () => {
      try {
        const newUser = (await createUser(data as any)) as any;
        // Sin reload: el mismo patrón se comió la API key recién generada en
        // abril (618fa7f). Con la contraseña mostrada una sola vez el fallo
        // sería irreversible, así que la tabla se actualiza en memoria.
        setUsers((prev) =>
          [
            ...prev,
            {
              ...newUser,
              status: newUser.status ?? "ACTIVE",
              suspendedAt: null,
              suspensionReason: null,
              deletedAt: null,
              phone: (data.phone as string) ?? null,
              sedetusNumber: (data.sedetusNumber as string) ?? null,
              sedetusExpiry: null,
              teamLeaderId: (data.teamLeaderId as string) ?? null,
              teamLeader: null,
              _count: { deals: 0, assignedContacts: 0 },
              createdAt: new Date(),
            } as UserData,
          ].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setUserDialogOpen(false);
        toast({ title: "Usuario creado", description: `${newUser.name} fue creado exitosamente` });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }

  async function handleUpdateUser(id: string, data: Record<string, unknown>) {
    startTransition(async () => {
      try {
        const updated = (await updateUser(id, data as any)) as any;
        patchUser(id, updated as Partial<UserData>);
        setUserDialogOpen(false);
        toast({ title: "Usuario actualizado" });
      } catch (error: any) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    });
  }
```

- [ ] **Step 2: Verificar que no queda ningún reload en los handlers de usuario**

```bash
grep -n "window.location.reload" src/components/admin/admin-content.tsx
```

Esperado: solo aparecen los de reglas de comisión (`handleCreateRule`, `handleUpdateRule`), que quedan fuera de alcance. Si aparece alguno dentro de `handleCreateUser` o `handleUpdateUser`, no terminaste el paso.

- [ ] **Step 3: Verificar typecheck y build**

```bash
npx tsc --noEmit
npm run build
```

Esperado: ambos limpios.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/admin-content.tsx
git commit -m "fix(users): la tabla se actualiza en memoria, sin recargar la pagina"
```

---

## Task 16: Verificación final

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Correr la suite completa y los gates**

```bash
npm test
npx tsc --noEmit
npm run build
```

Esperado: los tres verdes. La suite debe incluir los archivos nuevos: `asset-scopes`, `lifecycle-guards`, `users-lifecycle.status`, `.password`, `.reassign`, `.delete`, `.mirror`, `admin.getUsers`, `deleted-user-gate`.

- [ ] **Step 2: Confirmar que ningún test quedó saltado**

```bash
npm test 2>&1 | tail -20
```

Esperado: cero `skipped`, cero `todo`. Si hay alguno, arréglalo o bórralo — un test saltado es un test que no existe.

- [ ] **Step 3: Entregar la migración a Luis y esperar**

La migración está en `prisma/migrations-manual/2026-08-07-admin-user-lifecycle.sql` y **no se aplica desde aquí**: la base es la Supabase compartida `oaijxdpevakashxshhvm`. Avísale a Luis con la ruta del archivo y espera confirmación de que corrió.

Hasta que esté aplicada, cualquier lectura real de `status` falla contra la base. Los tests pasan porque tienen el cliente mockeado — eso no es evidencia de que funcione en producción.

- [ ] **Step 4: Verificación manual, ya con la migración aplicada**

Con `npm run build && npm start` (no `next dev`) y sesión de DIRECTOR en `/admin?tab=users`:

1. Un usuario cualquiera → Cambiar estado → Suspendido con motivo. El badge queda ámbar y el motivo aparece al pasar el cursor.
2. El mismo usuario → Cambiar estado → Activo. El badge vuelve a verde.
3. Cambiar contraseña de un usuario de prueba → la contraseña aparece en el banner amarillo → copiarla → cerrar. Salir de la sesión y entrar con ese usuario y esa contraseña.
4. Mover activos de ese usuario a otro: verificar que los conteos del diálogo coinciden con la columna Cartera, y que después del movimiento la fila origen baja a cero.
5. Eliminar ese usuario tecleando su nombre → desaparece de la tabla → "Ver eliminados" lo muestra en rojo → Restaurar lo devuelve como Inactivo.
6. Intentar suspender la propia cuenta: la opción no aparece en el menú.
7. Intentar eliminar a un Team Leader con equipo: debe rechazar nombrando a los subordinados.

- [ ] **Step 5: Reportar el resultado real**

Anotar qué pasó en cada punto del paso 4, incluido lo que no funcionó. No reportar la feature como terminada si algún punto falló.

---

## Cobertura del spec

| Sección del spec | Task |
|---|---|
| §1 Modelo de estados | 1, 4 |
| §2 Migración, espejo `isActive`, bug de `deletedAt` en auth | 1, 5, 9 |
| §3 Server actions | 4, 6, 7, 8 |
| §4 Scopes de activos | 2 |
| §5 Guards de rol e invariantes | 3, 4, 6, 8, 14 |
| §6 UI: tabla, diálogos, sin reload | 10, 11, 12, 13, 14, 15 |
| §7 Verificación | cada task + 16 |
| §8 Dependencias externas | 16 |

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
import { hash } from "bcryptjs";
import { randomBytes } from "crypto";
import {
  assertNotSelf,
  assertNotLastAdmin,
  assertNoDependents,
  assertNoLiveAssets,
  assertValidTarget,
} from "@/lib/users/lifecycle-guards";
import { ASSET_SCOPES, ASSET_SCOPE_KEYS, type AssetScope } from "@/lib/users/asset-scopes";

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
 * Cambia el estado de un usuario. `isActive` es la derivada
 * `status === 'ACTIVE'` y es lo que aplican el login y el ruteo de leads.
 *
 * El invariante del espejo es de MÓDULO, no de función: solo este archivo
 * escribe `status`/`isActive` sobre User — aquí, en `softDeleteUser` y en
 * `restoreUser`. Fuera de él, nadie. Eso es lo que verifica el guardrail de
 * `users-lifecycle.mirror.test.ts`.
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

  const user = await prisma.$transaction(
    async (tx) => {
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
    },
    // Serializable, no el READ COMMITTED por defecto: `assertNotLastAdmin`
    // cuenta administradores y decide en función de ese conteo. Con READ
    // COMMITTED, dos bajas simultáneas de los dos últimos admins ven cada una
    // "queda otro" y ambas pasan — el CRM se queda sin nadie que pueda entrar
    // al panel. Aquí una de las dos falla y se reintenta.
    { isolationLevel: "Serializable" },
  );

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

  // Un destino sin scopes no movería nada, y la bitácora quedaría afirmando
  // una reasignación que no ocurrió. Se rechaza en vez de descartar en silencio.
  if (opts?.reassignTo && !opts.scopes?.length) {
    throw new Error(
      "Indicaste un usuario destino pero ningún tipo de activo para mover",
    );
  }
  const validatedScopes = opts?.reassignTo
    ? scopeListSchema.parse(opts.scopes)
    : [];

  const result = await prisma.$transaction(
    async (tx) => {
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

    // Ya sea porque no se pidió reasignación, o porque los scopes elegidos no
    // cubrieron todo: si queda algo asignado, la baja se detiene. Un contacto
    // que apunta a una cuenta eliminada no aparece en ningún selector de
    // asesor y deja de ser trabajable sin que nadie se entere.
    await assertNoLiveAssets(tx, id);

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
    },
    // Mismo motivo que en setUserStatus: `assertNotLastAdmin` decide contando.
    { isolationLevel: "Serializable" },
  );

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

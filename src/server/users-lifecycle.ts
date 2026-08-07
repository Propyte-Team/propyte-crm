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

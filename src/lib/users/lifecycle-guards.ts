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

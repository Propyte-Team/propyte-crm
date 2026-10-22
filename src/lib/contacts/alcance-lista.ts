// ============================================================
// Alcance por rol de la lista de Contactos (GET /api/contacts)
// ============================================================
// Salió de app/api/contacts/route.ts sin cambiar de valor (#919): el filtro «Asesores»
// (/api/contacts/asesores) necesita EXACTAMENTE el mismo alcance para decir qué asesores
// ofrecer. Una segunda copia de esta regla habría divergido, que es el defecto que este CRM
// más ha repetido (#715 A-03, #730, #682). Los sets de roles también viven aquí porque el
// POST/PUT/DELETE de la ruta los usan.

import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { SIN_ASIGNAR } from "./filtro-asesores";

// Roles que tienen acceso a todos los contactos
export const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "DEVELOPER_EXT", "MANTENIMIENTO"];
// Roles que ven contactos de su plaza
export const PLAZA_ACCESS_ROLES = ["ADMIN", "GERENTE"];
// Roles que ven contactos de su equipo
export const TEAM_ACCESS_ROLES = ["ADMIN", "TEAM_LEADER"];
// Roles que solo ven contactos propios
export const OWN_ACCESS_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER"];
// Roles que pueden ver pero no modificar
export const READ_ONLY_ROLES = ["MARKETING", "HOSTESS", "MANTENIMIENTO"];

/**
 * Lo que el rol deja ver de la lista, como claves sueltas de un `where` (se mezcla con
 * `Object.assign`, que es lo que hacía el código en línea). `null` = rol no reconocido: 403.
 *
 * IMPORTANTE: el orden importa. ADMIN pertenece a varios sets (FULL/PLAZA/TEAM), así que
 * FULL_ACCESS se evalúa PRIMERO para no caer en una rama restrictiva.
 */
export async function alcanceListaContactos(user: {
  id: string;
  role: string;
  plaza?: string | null;
}): Promise<Prisma.ContactWhereInput | null> {
  const { id: userId, role: userRole } = user;

  if (FULL_ACCESS_ROLES.includes(userRole) || READ_ONLY_ROLES.includes(userRole)) {
    // Acceso total / solo lectura global: sin filtro adicional
    return {};
  }
  if (PLAZA_ACCESS_ROLES.includes(userRole)) {
    // Gerente ve contactos de asesores de su plaza (y los que no tienen dueño)
    const plazaUsers = await prisma.user.findMany({
      where: { plaza: user.plaza as never, isActive: true },
      select: { id: true },
    });
    return {
      OR: [{ assignedToId: { in: plazaUsers.map((u) => u.id) } }, { assignedToId: null }],
    };
  }
  if (TEAM_ACCESS_ROLES.includes(userRole)) {
    // Team leaders ven contactos de su equipo
    const teamMembers = await prisma.user.findMany({
      where: { teamLeaderId: userId },
      select: { id: true },
    });
    return { assignedToId: { in: [userId, ...teamMembers.map((m) => m.id)] } };
  }
  if (OWN_ACCESS_ROLES.includes(userRole)) {
    // Asesores solo ven sus contactos asignados
    return { assignedToId: userId };
  }
  return null;
}

/** El `where` del filtro por asesor. Se SUMA al alcance (#881), nunca lo reemplaza. */
export function filtroAsesor(assignedTo: string): Prisma.ContactWhereInput {
  return assignedTo === SIN_ASIGNAR ? { assignedToId: null } : { assignedToId: assignedTo };
}

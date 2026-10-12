// src/lib/inbox/scope.ts
// Alcance del inbox. UNA sola definición para la lista y para el detalle:
//   full view (ADMIN/DIRECTOR/GERENTE) → todo
//   TEAM_LEADER → suyos + sin asignar + los de sus reportes directos (User.teamLeaderId)
//   resto        → suyos + sin asignar
//
// Por qué el TL ve a su equipo: está en INBOX_MANAGERS (puede asignar), pero antes NO
// veía el hilo una vez asignado a un asesor → repartir la cola era un viaje sin retorno
// (404 al abrirlo, imposible supervisar o reasignar). Se le abre SOLO su equipo; sigue
// FUERA de INBOX_FULL_VIEW a propósito.
//
// Las dos funciones expresan la MISMA regla en dos formas (consulta SQL vs chequeo de un
// registro ya leído). scope.test.ts las cruza en una tabla de paridad: si divergen, rompe.
//
// Marcas (entrega 2, 2026-10-12): encima del alcance por rol va el filtro de marca de
// @/lib/brands/visibility, con AND. Aplica a TODOS los roles salvo ADMIN — incluida la vista
// completa (DIRECTOR/GERENTE) y la cola sin asignar: un hilo libre de Yaxnáh no aparece a quien
// no tiene Yaxnáh. `visible` es OBLIGATORIO a propósito: si fuera opcional, una ruta nueva que
// lo olvide mostraría todas las marcas sin que nada truene.
import type { Prisma } from "@prisma/client";
import { hasInboxFullView } from "./roles";
import {
  canSeeContactBrand,
  contactBrandVisibilityWhere,
  type VisibleBrands,
} from "@/lib/brands/visibility";

export type InboxScopeUser = { id: string; role: string };

// El único rol con alcance de equipo. No se mete en INBOX_FULL_VIEW ni en un set nuevo:
// es una regla de ALCANCE (depende de la jerarquía en datos), no una lista de roles.
const ROL_CON_EQUIPO = "TEAM_LEADER";

/**
 * Filtro de contactos visibles en el inbox para este usuario: alcance por rol AND marcas.
 * @returns `undefined` si el usuario ve TODO (no hay que filtrar nada).
 */
export function inboxScopeWhere(
  user: InboxScopeUser,
  visible: VisibleBrands
): Prisma.ContactWhereInput | undefined {
  const porRol = inboxRoleScopeWhere(user);
  const porMarca = contactBrandVisibilityWhere(user, visible);
  if (porRol && porMarca) return { AND: [porRol, porMarca] };
  return porRol ?? porMarca;
}

/** Solo el alcance por rol (sin marcas). Privado: toda consulta del inbox pasa por inboxScopeWhere. */
function inboxRoleScopeWhere(user: InboxScopeUser): Prisma.ContactWhereInput | undefined {
  if (hasInboxFullView(user.role)) return undefined;

  const alcance: Prisma.ContactWhereInput[] = [
    { assignedToId: user.id }, // suyos
    { assignedToId: null }, // la cola libre es de todos
  ];

  if (user.role === ROL_CON_EQUIPO) {
    // Relación to-one NULLABLE: `is` NO empareja cuando el contacto no tiene dueño, así
    // que este término solo suma los de sus reportes — los sin asignar ya entran arriba
    // y no se cuelan dos veces por semántica de relación vacía.
    alcance.push({ assignedTo: { is: { teamLeaderId: user.id } } });
  }

  return { OR: alcance };
}

/**
 * Misma regla que `inboxScopeWhere`, evaluada en memoria sobre un contacto ya leído
 * (detalle del hilo, gate de envío, gate de asignación).
 * `assignedTo.teamLeaderId` solo hace falta para el TEAM_LEADER; si el llamador no lo
 * trae, un contacto de otro asesor queda fuera de alcance (falla cerrado, no abierto).
 * Igual con `brands`: sin ellas, solo pasa lo asignado al propio usuario (ver visibility.ts).
 */
export function canViewInboxContact(
  contact: {
    assignedToId: string | null;
    assignedTo?: { teamLeaderId: string | null } | null;
    brands?: ReadonlyArray<{ brandId: string }> | null;
  },
  user: InboxScopeUser,
  visible: VisibleBrands
): boolean {
  return canViewInboxContactByRole(contact, user) && canSeeContactBrand(contact, user, visible);
}

function canViewInboxContactByRole(
  contact: { assignedToId: string | null; assignedTo?: { teamLeaderId: string | null } | null },
  user: InboxScopeUser
): boolean {
  if (hasInboxFullView(user.role)) return true;
  if (!contact.assignedToId) return true; // sin asignar
  if (contact.assignedToId === user.id) return true; // suyo
  if (user.role === ROL_CON_EQUIPO) return contact.assignedTo?.teamLeaderId === user.id;
  return false;
}

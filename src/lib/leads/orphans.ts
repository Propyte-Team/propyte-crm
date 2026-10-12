// «Leads huérfanos» — quién puede ver el panel y qué cuenta como huérfano. Módulo PURO
// (2026-10-12, entrega 3 de marcas, decisión 3 del dueño).
//
// Un panel para mandos que junta los prospectos que se pueden estar perdiendo:
//   a) contactos vivos SIN dueño (assignedToId null);
//   b) contactos vivos cuyo dueño es una cuenta técnica (correo del dominio de QA, ver ruteables.ts):
//      el reparto ya no les da a esas cuentas, pero lo que se les asignó antes sigue ahí (#734);
//   c) conversaciones cuya ÚLTIMA nota interna dice que el mensaje llegó a un número o una cuenta
//      que no está dado de alta en Conexiones: el agente no contestó y nadie más se enteró.
//
// Todo va recortado por las marcas que ve quien mira (visibility.ts), igual que Contactos. La (c)
// además respeta el alcance de la bandeja (inboxScopeWhere), porque su enlace abre el hilo en la
// bandeja: listar un hilo que luego responde 404 sería un enlace roto.
import type { Prisma } from "@prisma/client";
import { realLeadWhere } from "./real-leads";
import { DOMINIO_TECNICO } from "@/lib/workflows/ruteables";
import { contactBrandVisibilityWhere, type VisibleBrands } from "@/lib/brands/visibility";
import { inboxScopeWhere, type InboxScopeUser } from "@/lib/inbox/scope";
import {
  UNREGISTERED_META_NOTE_MARKER,
  UNREGISTERED_META_NOTE_PREFIX,
  UNREGISTERED_WA_NOTE_PREFIX,
} from "@/lib/messaging/unregistered-account";

/**
 * Los mismos roles que ven Conexiones (página /conexiones y menú del nombre): el caso (c) se
 * arregla dando de alta la cuenta ahí, y marketing es quien más leads pierde por esto.
 * Fail-closed: un rol ausente o desconocido no pasa.
 */
export const ORPHAN_LEADS_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"] as const;

export function canSeeOrphanLeads(role: string | null | undefined): boolean {
  return !!role && (ORPHAN_LEADS_ROLES as readonly string[]).includes(role);
}

/**
 * Contacto vivo, de los que cuentan como lead, dentro de las marcas que ve quien mira.
 * realLeadWhere quita a los provisionales de comentarios que nunca contestaron: nacen sin dueño a
 * propósito (no se rutean) y llenarían la lista (a) de gente a la que solo le escribimos nosotros.
 */
function liveLeadWhere(
  viewer: { id: string },
  visible: VisibleBrands,
  extra: Prisma.ContactWhereInput,
): Prisma.ContactWhereInput {
  const porMarca = contactBrandVisibilityWhere(viewer, visible);
  return realLeadWhere({
    deletedAt: null,
    mergedIntoId: null,
    ...extra,
    ...(porMarca ? { AND: [porMarca] } : {}),
  });
}

/** (a) Sin dueño. */
export function unownedContactsWhere(viewer: { id: string }, visible: VisibleBrands): Prisma.ContactWhereInput {
  return liveLeadWhere(viewer, visible, { assignedToId: null });
}

/** (b) Con dueño técnico (correo del dominio de cuentas internas / QA). */
export function technicalOwnerContactsWhere(
  viewer: { id: string },
  visible: VisibleBrands,
): Prisma.ContactWhereInput {
  return liveLeadWhere(viewer, visible, { assignedTo: { is: { email: { endsWith: DOMINIO_TECNICO } } } });
}

/**
 * (c) Notas «llegó a una cuenta o número sin registrar» de hilos abiertos que quien mira ve en la
 * bandeja. Que sea la ÚLTIMA nota interna del hilo se decide después (latestNotesOnly): Prisma no
 * filtra por "la fila más reciente de una relación".
 * Un hilo cerrado sale de la lista: cerrarlo es la forma de decir «ya me encargué».
 */
export function unregisteredAccountNoteWhere(viewer: InboxScopeUser, visible: VisibleBrands): Prisma.MessageWhereInput {
  const alcance = inboxScopeWhere(viewer, visible);
  return {
    internalNote: true,
    sender: "SYSTEM",
    OR: [
      { body: { startsWith: UNREGISTERED_WA_NOTE_PREFIX } },
      {
        AND: [
          { body: { startsWith: UNREGISTERED_META_NOTE_PREFIX } },
          { body: { contains: UNREGISTERED_META_NOTE_MARKER } },
        ],
      },
    ],
    conversation: {
      is: {
        status: { not: "CLOSED" },
        contact: { deletedAt: null, mergedIntoId: null, ...(alcance ? { AND: [alcance] } : {}) },
      },
    },
  };
}

/**
 * Se queda solo con las notas que siguen siendo la última nota interna de su hilo. Si después
 * alguien escribió una nota (un asesor que ya lo vio, otro aviso del bot), el hilo ya no está
 * huérfano de atención y sale de la lista.
 * @param latestByConversation id de la nota interna más reciente de cada hilo.
 */
export function latestNotesOnly<T extends { id: string; conversationId: string | null }>(
  notes: readonly T[],
  latestByConversation: ReadonlyMap<string, string>,
): T[] {
  return notes.filter((n) => n.conversationId !== null && latestByConversation.get(n.conversationId) === n.id);
}

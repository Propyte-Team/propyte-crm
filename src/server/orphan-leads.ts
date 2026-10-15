// Lecturas del panel «Leads huérfanos» (2026-10-12, entrega 3 de marcas, decisión 3).
// Qué cuenta como huérfano y quién lo ve vive en @/lib/leads/orphans (puro); aquí solo se consulta
// y se deja cada renglón listo para pintar (fechas en ISO, cuenta sin registrar ya leída de la nota).
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { getVisibleBrands } from "@/lib/brands/user-access";
import { CONTACT_BRAND_SELECT, contactBrandVisibilityWhere } from "@/lib/brands/visibility";
import { assignContact, type AssignResult } from "@/lib/inbox/assign";
import { canOwnInboxContact, INBOX_OWNER_ROLES } from "@/lib/inbox/roles";
import { esCuentaTecnica, usuarioRuteableWhere } from "@/lib/workflows/ruteables";
import {
  canSeeOrphanLeads,
  latestNotesOnly,
  technicalOwnerContactsWhere,
  unownedContactsWhere,
  unregisteredAccountNoteWhere,
} from "@/lib/leads/orphans";
import { parseUnregisteredAccountNote, type UnregisteredAccount } from "@/lib/messaging/unregistered-account";

export type OrphanContactRow = {
  id: string;
  name: string;
  leadSource: string;
  createdAt: string;
  /** Último mensaje real (sin notas internas). */
  lastMessageAt: string | null;
  brandIds: string[];
  owner: { name: string; email: string } | null;
};

export type OrphanConversationRow = {
  conversationId: string;
  contactId: string;
  name: string;
  leadSource: string;
  createdAt: string;
  lastMessageAt: string | null;
  noteAt: string;
  account: UnregisteredAccount | null;
  brandIds: string[];
  owner: { name: string; email: string } | null;
};

export type OrphanSection<T> = { rows: T[]; total: number };

export type OrphanLeads = {
  unowned: OrphanSection<OrphanContactRow>;
  technical: OrphanSection<OrphanContactRow>;
  unregistered: OrphanSection<OrphanConversationRow>;
};

const CONTACT_ROW_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  leadSource: true,
  createdAt: true,
  brands: CONTACT_BRAND_SELECT,
  assignedTo: { select: { name: true, email: true } },
  messages: {
    where: { internalNote: false },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { createdAt: true },
  },
} satisfies Prisma.ContactSelect;

type ContactRowData = Prisma.ContactGetPayload<{ select: typeof CONTACT_ROW_SELECT }>;

function contactRow(c: ContactRowData): OrphanContactRow {
  return {
    id: c.id,
    name: `${c.firstName} ${c.lastName}`.trim(),
    leadSource: c.leadSource,
    createdAt: c.createdAt.toISOString(),
    lastMessageAt: c.messages[0]?.createdAt.toISOString() ?? null,
    brandIds: c.brands.map((b) => b.brandId),
    owner: c.assignedTo ? { name: c.assignedTo.name, email: c.assignedTo.email } : null,
  };
}

/**
 * Cuántas notas se revisan para el caso (c). Las notas se deduplican por hilo cada 24 h
 * (send-failure.ts), así que esto son hilos, no mensajes: de sobra para un panel de revisión.
 */
const NOTE_SCAN_LIMIT = 200;

/**
 * Los tres listados, recortados por las marcas que ve `viewer`.
 * - null si el rol no puede ver el panel (falla cerrado; la página ya redirige antes).
 * - `limit` = renglones por sección; `total` cuenta todos (en (c), hasta NOTE_SCAN_LIMIT hilos).
 */
export async function getOrphanLeads(
  viewer: { id: string; role: string },
  opts: { limit?: number } = {},
): Promise<OrphanLeads | null> {
  if (!canSeeOrphanLeads(viewer.role)) return null;
  const limit = Math.max(0, opts.limit ?? 50);
  const visible = await getVisibleBrands(viewer);

  const unownedWhere = unownedContactsWhere(viewer, visible);
  const technicalWhere = technicalOwnerContactsWhere(viewer, visible);

  const [unownedRows, unownedTotal, technicalRows, technicalTotal, notes] = await Promise.all([
    prisma.contact.findMany({ where: unownedWhere, orderBy: { createdAt: "desc" }, take: limit, select: CONTACT_ROW_SELECT }),
    prisma.contact.count({ where: unownedWhere }),
    prisma.contact.findMany({ where: technicalWhere, orderBy: { createdAt: "desc" }, take: limit, select: CONTACT_ROW_SELECT }),
    prisma.contact.count({ where: technicalWhere }),
    prisma.message.findMany({
      where: unregisteredAccountNoteWhere(viewer, visible),
      orderBy: { createdAt: "desc" },
      // La nota más reciente de este tipo por hilo; si el hilo tiene una nota interna más nueva
      // de otra clase, latestNotesOnly lo saca abajo.
      distinct: ["conversationId"],
      take: NOTE_SCAN_LIMIT,
      select: {
        id: true,
        body: true,
        createdAt: true,
        conversationId: true,
        conversation: {
          select: {
            lastMessageAt: true,
            contact: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                leadSource: true,
                createdAt: true,
                brands: CONTACT_BRAND_SELECT,
                assignedTo: { select: { name: true, email: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const conversationIds = notes.map((n) => n.conversationId).filter((id): id is string => !!id);
  const latest =
    conversationIds.length > 0
      ? await prisma.message.findMany({
          where: { conversationId: { in: conversationIds }, internalNote: true },
          orderBy: { createdAt: "desc" },
          distinct: ["conversationId"],
          select: { id: true, conversationId: true },
        })
      : [];
  const latestByConversation = new Map(
    latest.filter((m) => m.conversationId).map((m) => [m.conversationId as string, m.id]),
  );

  const unregistered = latestNotesOnly(notes, latestByConversation).flatMap((n): OrphanConversationRow[] => {
    const conv = n.conversation;
    if (!conv || !n.conversationId) return [];
    const c = conv.contact;
    return [
      {
        conversationId: n.conversationId,
        contactId: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        leadSource: c.leadSource,
        createdAt: c.createdAt.toISOString(),
        lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
        noteAt: n.createdAt.toISOString(),
        account: parseUnregisteredAccountNote(n.body),
        brandIds: c.brands.map((b) => b.brandId),
        owner: c.assignedTo ? { name: c.assignedTo.name, email: c.assignedTo.email } : null,
      },
    ];
  });

  return {
    unowned: { rows: unownedRows.map(contactRow), total: unownedTotal },
    technical: { rows: technicalRows.map(contactRow), total: technicalTotal },
    unregistered: { rows: unregistered.slice(0, limit), total: unregistered.length },
  };
}

/** Total para el aviso de /conexiones. Best-effort: si algo falla, sin número (no tumba la página). */
export async function countOrphanLeads(viewer: { id: string; role: string }): Promise<number | null> {
  try {
    const data = await getOrphanLeads(viewer, { limit: 0 });
    if (!data) return null;
    return data.unowned.total + data.technical.total + data.unregistered.total;
  } catch (err) {
    console.error("[leads-huerfanos] no se pudo contar", err);
    return null;
  }
}

// ─────────────────────────── asignación masiva (#883, 2026-10-14) ───────────────────────────
//
// «Seleccionar todos → Asignar a…» del panel. No escribe nada por su cuenta: cada contacto pasa
// por assignContact (lib/inbox/assign.ts) en su modo panel, así que se lleva los mismos permisos
// sobre el asignado, la misma cronología con quien asignó como actor, el mismo cierre del ORPHAN,
// la misma liberación del hilo y la misma actividad que una asignación de uno en uno. Lo único
// que el lote hace distinto es el aviso: UNO por asignado con el total, no uno por contacto
// (con los 111 huérfanos de hoy serían 111 avisos seguidos).

/**
 * Tope de contactos por petición. Los 111 huérfanos medidos el 2026-10-14 caben en una sola (un
 * solo aviso); con más, el panel parte la selección en varias peticiones.
 */
export const MAX_ASIGNACION_POR_LOTE = 200;

/**
 * Asignaciones a la vez. Cada una es una transacción corta sobre un contacto distinto, así que no
 * se pisan; en serie, 200 contactos a ~8 viajes a la base cada uno tardarían de más.
 */
const CONCURRENCIA_LOTE = 5;

/** Mismo `type` que el aviso del reparto automático (routing.ts): para quien lo recibe es lo mismo. */
export const BULK_ASSIGN_NOTIFICATION_TYPE = "lead_assigned";

type AssignFailCode = Extract<AssignResult, { ok: false }>["code"];

export type FalloAsignacion = { contactId: string; code: AssignFailCode | "error" };

export type ResultadoLote =
  | {
      ok: true;
      /** Cambiaron de dueño en esta petición. */
      asignados: number;
      /** Ya eran del destino (repetir el lote no escribe ni avisa otra vez). */
      yaEranSuyos: number;
      fallidos: FalloAsignacion[];
      assignee: { id: string; name: string };
    }
  | { ok: false; code: "sin-permiso" | "usuario-invalido" | "demasiados" | "vacio" };

export type OrphanAssignee = { id: string; name: string };

/**
 * A quién se puede asignar desde el panel: personas (la regla única de ruteables.ts: activas, no
 * borradas, sin correo técnico) con un rol que puede ser dueño de un contacto — exactamente lo que
 * assignContact va a aceptar, para que el selector no ofrezca a nadie que luego se rechace.
 */
export async function getOrphanAssignees(): Promise<OrphanAssignee[]> {
  return prisma.user.findMany({
    where: { ...usuarioRuteableWhere(), role: { in: [...INBOX_OWNER_ROLES] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Asigna `contactIds` a `assigneeId` en nombre de `actor`.
 *  - Quién: los roles que ven el panel (canSeeOrphanLeads). Falla cerrado.
 *  - A quién: una persona (usuarioRuteableWhere) con rol de dueño. Se valida UNA vez antes de tocar
 *    ningún contacto: un destino inválido no deja el lote a medias.
 *  - Qué: solo contactos que quien asigna ve por marca —los mismos que le lista el panel—. Uno de
 *    otra marca da el mismo «no-existe» que uno borrado: distinguirlos confirmaría que existe. Y
 *    assignContact rechaza ("ya-asignado") el que ya tiene un dueño de verdad.
 *  - Fallas por contacto: se reportan y el resto sigue. Idempotente: repetirlo no reescribe nada.
 */
export async function asignarHuerfanosEnLote(opts: {
  actor: { id: string; role: string };
  contactIds: readonly string[];
  assigneeId: string;
}): Promise<ResultadoLote> {
  const { actor, assigneeId } = opts;
  if (!canSeeOrphanLeads(actor.role)) return { ok: false, code: "sin-permiso" };

  const ids = [...new Set(opts.contactIds)];
  if (ids.length === 0) return { ok: false, code: "vacio" };
  if (ids.length > MAX_ASIGNACION_POR_LOTE) return { ok: false, code: "demasiados" };

  const assignee = await prisma.user.findFirst({
    where: { id: assigneeId, ...usuarioRuteableWhere() },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!assignee || esCuentaTecnica(assignee.email) || !canOwnInboxContact(assignee.role)) {
    return { ok: false, code: "usuario-invalido" };
  }

  const visible = await getVisibleBrands(actor);
  const porMarca = contactBrandVisibilityWhere(actor, visible);
  const visibles = await prisma.contact.findMany({
    where: { id: { in: ids }, deletedAt: null, mergedIntoId: null, ...(porMarca ? { AND: [porMarca] } : {}) },
    select: { id: true },
  });
  const loVe = new Set(visibles.map((c) => c.id));

  const fallidos: FalloAsignacion[] = [];
  let asignados = 0;
  let yaEranSuyos = 0;
  const pendientes = ids.filter((id) => {
    if (loVe.has(id)) return true;
    fallidos.push({ contactId: id, code: "no-existe" });
    return false;
  });

  for (let i = 0; i < pendientes.length; i += CONCURRENCIA_LOTE) {
    const tanda = pendientes.slice(i, i + CONCURRENCIA_LOTE);
    const resultados = await Promise.allSettled(
      tanda.map((contactId) =>
        assignContact({ contactId, assigneeId, actor, source: "orphan_bulk_assign", panelHuerfanos: true }),
      ),
    );
    resultados.forEach((r, j) => {
      const contactId = tanda[j];
      if (r.status === "rejected") {
        // Una base caída en un contacto no tumba a los demás; queda en el reporte y en el log.
        console.error(`[leads-huerfanos] no se pudo asignar ${contactId}:`, r.reason);
        fallidos.push({ contactId, code: "error" });
      } else if (!r.value.ok) {
        fallidos.push({ contactId, code: r.value.code });
      } else if (r.value.sinCambio) {
        yaEranSuyos++;
      } else {
        asignados++;
      }
    });
  }

  // Un aviso por asignado por lote, con lo que de verdad cambió. Asignarse a sí mismo no avisa
  // (igual que assignContact). Best-effort: las asignaciones ya quedaron.
  if (asignados > 0 && assignee.id !== actor.id) {
    try {
      await prisma.notification.create({
        data: {
          userId: assignee.id,
          type: BULK_ASSIGN_NOTIFICATION_TYPE,
          title: "Prospectos asignados",
          message:
            asignados === 1
              ? "Se te asignó 1 prospecto desde Leads huérfanos"
              : `Se te asignaron ${asignados} prospectos desde Leads huérfanos`,
          link: "/contacts",
        },
      });
    } catch (err) {
      console.error("[leads-huerfanos] no se pudo avisar al asignado del lote", err);
    }
  }

  return { ok: true, asignados, yaEranSuyos, fallidos, assignee: { id: assignee.id, name: assignee.name } };
}

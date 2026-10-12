// Lecturas del panel «Leads huérfanos» (2026-10-12, entrega 3 de marcas, decisión 3).
// Qué cuenta como huérfano y quién lo ve vive en @/lib/leads/orphans (puro); aquí solo se consulta
// y se deja cada renglón listo para pintar (fechas en ISO, cuenta sin registrar ya leída de la nota).
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { getVisibleBrands } from "@/lib/brands/user-access";
import { CONTACT_BRAND_SELECT } from "@/lib/brands/visibility";
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

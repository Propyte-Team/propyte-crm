// ============================================================
// Agenda personal del asesor (spec §6, Fase 2)
// Lectura de pendientes propios. SIEMPRE con el userId de la sesión:
// una agenda personal no muestra pendientes ajenos ni a un ADMIN, y así
// además se esquiva el orden de rolesets de src/server/activities.ts:113.
// ============================================================

import prisma from "@/lib/db";
import { Prisma, type ActivityType } from "@prisma/client";
import { getServerSession } from "@/lib/auth/session";
import { groupAgenda, type AgendaBuckets, type AgendaItem } from "@/lib/agenda/grouping";

// Topes de lectura POR BUCKET, no uno global. Un `orderBy: dueDate asc` dado
// que en Postgres manda los NULL al final, combinado con un `take` único,
// hacía que un asesor con 200+ pendientes CON fecha se quedara con el bucket
// `sin_fecha` truncado a cero siempre — no ocasional, estructural. Las tareas
// sin fecha son el caso principal de la captura rápida (fecha opcional), así
// que cada rama tiene su propio cupo garantizado.
const AGENDA_TAKE_CON_FECHA = 200;
const AGENDA_TAKE_SIN_FECHA = 50;

/** Única fuente de verdad de las columnas leídas: se usa en ambas queries. */
const AGENDA_SELECT = {
  id: true,
  subject: true,
  activityType: true,
  status: true,
  dueDate: true,
  contactId: true,
  contact: { select: { id: true, firstName: true, lastName: true } },
  // #915: quién la asignó, cuando no es su dueño.
  createdById: true,
} satisfies Prisma.ActivitySelect;

export interface MyAgenda {
  buckets: AgendaBuckets;
  /** Pendientes existentes en base, no los que alcanzó a traer el tope. */
  total: number;
  /** true si los topes recortaron algo — la UI debe poder avisar que no se ve todo. */
  truncated: boolean;
}

export async function getMyAgenda(now: Date = new Date()): Promise<MyAgenda> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const baseWhere: Prisma.ActivityWhereInput = {
    userId: session.user.id,
    deletedAt: null,
    status: { in: ["PENDIENTE", "VENCIDA"] },
  };

  const [conFecha, sinFecha, total] = await Promise.all([
    prisma.activity.findMany({
      where: { ...baseWhere, dueDate: { not: null } },
      select: AGENDA_SELECT,
      orderBy: { dueDate: "asc" },
      take: AGENDA_TAKE_CON_FECHA,
    }),
    prisma.activity.findMany({
      where: { ...baseWhere, dueDate: null },
      select: AGENDA_SELECT,
      orderBy: { createdAt: "desc" },
      take: AGENDA_TAKE_SIN_FECHA,
    }),
    prisma.activity.count({ where: baseWhere }),
  ]);

  const rows = [...conFecha, ...sinFecha];

  // #915: «Te la asignó …». createdById es FK lógica sin relación de Prisma (no se expande
  // User), así que los nombres se leen en una sola consulta aparte.
  const creadores = [
    ...new Set(rows.map((r) => r.createdById).filter((id): id is string => !!id && id !== session.user.id)),
  ];
  const nombres = new Map(
    creadores.length
      ? (
          await prisma.user.findMany({ where: { id: { in: creadores } }, select: { id: true, name: true } })
        ).map((u) => [u.id, u.name])
      : [],
  );

  const items: AgendaItem[] = rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    activityType: r.activityType,
    status: r.status,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    contactId: r.contactId,
    contactName: r.contact ? `${r.contact.firstName} ${r.contact.lastName}` : null,
    assignedByName: r.createdById ? (nombres.get(r.createdById) ?? null) : null,
  }));

  return {
    buckets: groupAgenda(items, now),
    total,
    truncated: items.length < total,
  };
}

// ------------------------------------------------------------
// Reuniones y Llamadas pendientes (HUB #842): tablas con columnas configurables.
// ------------------------------------------------------------

const MEETING_TYPES: ActivityType[] = ["MEETING_VIRTUAL", "MEETING_PRESENTIAL", "MEETING_SHOWROOM"];
const CALL_TYPES: ActivityType[] = ["CALL_OUTBOUND", "CALL_INBOUND"];

/** Tope por tabla. Un asesor con más pendientes de reuniones/llamadas que esto es excepcional. */
const TABLE_TAKE = 100;

/** Fila común de las tablas de reuniones y llamadas. Fechas en ISO 8601. */
export interface AgendaActivityRow {
  id: string;
  subject: string;
  activityType: string;
  status: string;
  dueDate: string | null;
  durationMinutes: number | null;
  description: string | null;
  outcome: string | null;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  /** "Relacionado con": desarrollo y etapa del negocio, si la actividad cuelga de uno. */
  dealId: string | null;
  dealLabel: string | null;
  /** Dueño y creador de la actividad (en este modelo son la misma persona). */
  userName: string | null;
  createdAt: string;
  updatedAt: string;
}

async function getMyPendingActivities(types: ActivityType[]): Promise<AgendaActivityRow[]> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const rows = await prisma.activity.findMany({
    where: {
      userId: session.user.id,
      deletedAt: null,
      activityType: { in: types },
      status: { in: ["PENDIENTE", "VENCIDA"] },
    },
    select: {
      id: true,
      subject: true,
      activityType: true,
      status: true,
      dueDate: true,
      duration_minutes: true,
      description: true,
      outcome: true,
      createdAt: true,
      updatedAt: true,
      contactId: true,
      contact: { select: { firstName: true, lastName: true, phone: true } },
      dealId: true,
      deal: { select: { stage: true, development: { select: { name: true } } } },
      user: { select: { name: true } },
    },
    // Los NULL van al final en Postgres con asc: lo con fecha primero, lo próximo arriba.
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: TABLE_TAKE,
  });

  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    activityType: r.activityType,
    status: r.status,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    durationMinutes: r.duration_minutes,
    description: r.description,
    outcome: r.outcome,
    contactId: r.contactId,
    contactName: r.contact ? `${r.contact.firstName} ${r.contact.lastName}` : null,
    contactPhone: r.contact?.phone ?? null,
    dealId: r.dealId,
    dealLabel: r.deal
      ? [r.deal.development?.name, r.deal.stage].filter(Boolean).join(" · ")
      : null,
    userName: r.user?.name ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Reuniones (virtual, presencial, showroom) pendientes del asesor. Siempre con el userId de la sesión. */
export function getMyPendingMeetings(): Promise<AgendaActivityRow[]> {
  return getMyPendingActivities(MEETING_TYPES);
}

/** Llamadas (salientes y entrantes) pendientes del asesor. Siempre con el userId de la sesión. */
export function getMyPendingCalls(): Promise<AgendaActivityRow[]> {
  return getMyPendingActivities(CALL_TYPES);
}

/** Tope de tareas hechas visibles en el panel derecho. */
const DONE_TAKE = 50;

export interface AgendaDoneItem {
  id: string;
  subject: string;
  completedAt: string | null; // ISO 8601
  contactId: string | null;
  contactName: string | null;
}

export interface MyDoneTasks {
  items: AgendaDoneItem[];
  /** Completadas sin archivar que existen en base (puede exceder lo mostrado). */
  total: number;
}

/**
 * Tareas completadas del asesor que aún no archivó (panel "Tareas hechas").
 * Solo TASK: las NOTE nacen COMPLETADA pero viven en "Notas recientes".
 * Siempre con el userId de la sesión, igual que getMyAgenda.
 */
export async function getMyDoneTasks(): Promise<MyDoneTasks> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const where: Prisma.ActivityWhereInput = {
    userId: session.user.id,
    deletedAt: null,
    activityType: "TASK",
    status: "COMPLETADA",
    archivedAt: null,
  };

  const [rows, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      select: {
        id: true,
        subject: true,
        completedAt: true,
        contactId: true,
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { completedAt: "desc" },
      take: DONE_TAKE,
    }),
    prisma.activity.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      contactId: r.contactId,
      contactName: r.contact ? `${r.contact.firstName} ${r.contact.lastName}` : null,
    })),
    total,
  };
}

/**
 * "Eliminar todo" del panel Tareas hechas: ARCHIVA (no borra) las tareas
 * completadas del asesor. Dejan de verse en su agenda, pero siguen en base con
 * completedById/completedAt/archivedById/archivedAt para los reportes de admin.
 * Solo toca TASK COMPLETADA del propio usuario: nunca pendientes, notas ni ajenas.
 */
export async function archiveMyDoneTasks(): Promise<{ archived: number }> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const res = await prisma.activity.updateMany({
    where: {
      userId: session.user.id,
      deletedAt: null,
      activityType: "TASK",
      status: "COMPLETADA",
      archivedAt: null,
    },
    data: { archivedAt: new Date(), archivedById: session.user.id },
  });

  return { archived: res.count };
}

/** Tope de notas recientes en la vista. */
const NOTES_TAKE = 20;

/** Tope de ids por llamada a "Eliminar seleccionadas" (#924). */
export const NOTES_ARCHIVE_MAX_IDS = 100;

export interface AgendaNote {
  id: string;
  subject: string;
  description: string | null;
  createdAt: string; // ISO 8601
  contactId: string | null;
  contactName: string | null;
}

/**
 * Notas del asesor que siguen visibles en su Agenda. #924: las archivadas (archivedAt) salen de
 * aquí, pero no de la ficha del contacto, que no filtra por archivado.
 */
function myNotesWhere(userId: string): Prisma.ActivityWhereInput {
  return { userId, deletedAt: null, activityType: "NOTE", archivedAt: null };
}

/**
 * Notas del asesor. Una NOTE nace COMPLETADA (src/server/activities.ts:205),
 * así que queda fuera de getMyAgenda: sin esta lista, capturar una nota la
 * haría desaparecer de la vista.
 */
export async function getMyRecentNotes(): Promise<AgendaNote[]> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const rows = await prisma.activity.findMany({
    where: myNotesWhere(session.user.id),
    select: {
      id: true,
      subject: true,
      description: true,
      createdAt: true,
      contactId: true,
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: NOTES_TAKE,
  });

  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    description: r.description,
    createdAt: r.createdAt.toISOString(),
    contactId: r.contactId,
    contactName: r.contact ? `${r.contact.firstName} ${r.contact.lastName}` : null,
  }));
}

/** Cuántas notas visibles tiene el asesor, no solo las {@link NOTES_TAKE} que se pintan (#924). */
export async function countMyRecentNotes(): Promise<number> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");
  return prisma.activity.count({ where: myNotesWhere(session.user.id) });
}

/**
 * "Eliminar" de Notas recientes (#924). Como "Eliminar todo" de Tareas hechas (#841), ARCHIVA:
 * la nota deja de verse en la Agenda pero sigue en la ficha del contacto y en los reportes.
 *
 * - `{ todas: true }` archiva TODAS las notas visibles del usuario, no solo las 20 que se pintan:
 *   si no, al "eliminar todo" aparecerían las siguientes 20.
 * - `{ ids }` archiva solo esas. El `where` lleva siempre el userId de la sesión, así que un id
 *   ajeno, inexistente, que no es NOTE o ya archivado simplemente no cuenta (sin error).
 */
export async function archiveMyNotes(
  input: { todas: true } | { ids: string[] },
): Promise<{ archived: number }> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const where = myNotesWhere(session.user.id);
  if (!("todas" in input)) {
    const ids = [...new Set(input.ids)];
    if (ids.length === 0) return { archived: 0 };
    if (ids.length > NOTES_ARCHIVE_MAX_IDS) {
      throw new Error(`Máximo ${NOTES_ARCHIVE_MAX_IDS} notas por vez`);
    }
    where.id = { in: ids };
  }

  const res = await prisma.activity.updateMany({
    where,
    data: { archivedAt: new Date(), archivedById: session.user.id },
  });
  return { archived: res.count };
}

// ------------------------------------------------------------
// Tareas que asignaste (#915): las que dejaste a otra persona y siguen pendientes.
// ------------------------------------------------------------

export interface TareaAsignadaPorMi {
  id: string;
  subject: string;
  dueDate: string | null;
  contactId: string | null;
  contactName: string | null;
  assigneeName: string | null;
}

/**
 * Para el líder, gerente, director o admin que asigna: lo que dejó a otros y todavía no está
 * hecho. Lee por creador (`createdById` = sesión) y excluye las suyas, así que un asesor, que no
 * puede asignar, siempre recibe una lista vacía.
 */
export async function getMyAssignedTasks(): Promise<TareaAsignadaPorMi[]> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const rows = await prisma.activity.findMany({
    where: {
      createdById: session.user.id,
      userId: { not: session.user.id },
      deletedAt: null,
      status: { in: ["PENDIENTE", "VENCIDA"] },
    },
    select: {
      id: true,
      subject: true,
      dueDate: true,
      contactId: true,
      contact: { select: { firstName: true, lastName: true } },
      user: { select: { name: true } },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: TABLE_TAKE,
  });

  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    contactId: r.contactId,
    contactName: r.contact ? `${r.contact.firstName} ${r.contact.lastName}` : null,
    assigneeName: r.user?.name ?? null,
  }));
}

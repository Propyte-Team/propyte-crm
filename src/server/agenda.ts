// ============================================================
// Agenda personal del asesor (spec §6, Fase 2)
// Lectura de pendientes propios. SIEMPRE con el userId de la sesión:
// una agenda personal no muestra pendientes ajenos ni a un ADMIN, y así
// además se esquiva el orden de rolesets de src/server/activities.ts:113.
// ============================================================

import prisma from "@/lib/db";
import { Prisma } from "@prisma/client";
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

  const items: AgendaItem[] = rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    activityType: r.activityType,
    status: r.status,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    contactId: r.contactId,
    contactName: r.contact ? `${r.contact.firstName} ${r.contact.lastName}` : null,
  }));

  return {
    buckets: groupAgenda(items, now),
    total,
    truncated: items.length < total,
  };
}

/** Tope de notas recientes en la vista. */
const NOTES_TAKE = 20;

export interface AgendaNote {
  id: string;
  subject: string;
  description: string | null;
  createdAt: string; // ISO 8601
  contactId: string | null;
  contactName: string | null;
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
    where: {
      userId: session.user.id,
      deletedAt: null,
      activityType: "NOTE",
    },
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

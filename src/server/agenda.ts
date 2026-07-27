// ============================================================
// Agenda personal del asesor (spec §6, Fase 2)
// Lectura de pendientes propios. SIEMPRE con el userId de la sesión:
// una agenda personal no muestra pendientes ajenos ni a un ADMIN, y así
// además se esquiva el orden de rolesets de src/server/activities.ts:113.
// ============================================================

import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { groupAgenda, type AgendaBuckets, type AgendaItem } from "@/lib/agenda/grouping";

/** Tope de lectura. Una agenda personal por encima de esto ya no se navega, se filtra. */
const AGENDA_TAKE = 200;

export interface MyAgenda {
  buckets: AgendaBuckets;
  total: number;
}

export async function getMyAgenda(now: Date = new Date()): Promise<MyAgenda> {
  const session = await getServerSession();
  if (!session?.user) throw new Error("No autorizado");

  const rows = await prisma.activity.findMany({
    where: {
      userId: session.user.id,
      deletedAt: null,
      status: { in: ["PENDIENTE", "VENCIDA"] },
    },
    select: {
      id: true,
      subject: true,
      activityType: true,
      status: true,
      dueDate: true,
      contactId: true,
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
    // En Postgres, ASC deja los NULL al final: los sin fecha caen al fondo.
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: AGENDA_TAKE,
  });

  const items: AgendaItem[] = rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    activityType: r.activityType,
    status: r.status,
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    contactId: r.contactId,
    contactName: r.contact ? `${r.contact.firstName} ${r.contact.lastName}` : null,
  }));

  return { buckets: groupAgenda(items, now), total: items.length };
}

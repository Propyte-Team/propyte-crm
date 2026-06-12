"use server";

// Vista Hoy del asesor (Fase 2, T2.1). Agrega lo accionable del día en una sola
// consulta server-side con RBAC: ASESOR ve lo suyo, TEAM_LEADER su equipo, dirección todo.
import prisma from "@/lib/db";

const OWN_ROLES = ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER"];
const TEAM_ROLES = ["TEAM_LEADER"];

export interface TodayMini {
  id: string;
  title: string;
  subtitle?: string;
  href?: string;
  meta?: string;
}

export interface TodayView {
  newLeads: { count: number; items: TodayMini[] };
  slaAtRisk: { count: number; items: TodayMini[] };
  tasks: { count: number; items: TodayMini[] };
  conversations: { count: number; items: TodayMini[] };
  visits: { count: number; items: TodayMini[] };
  hotDeals: { count: number; items: TodayMini[] };
  openQuotes: { count: number };
}

const EMPTY: TodayView = {
  newLeads: { count: 0, items: [] },
  slaAtRisk: { count: 0, items: [] },
  tasks: { count: 0, items: [] },
  conversations: { count: 0, items: [] },
  visits: { count: 0, items: [] },
  hotDeals: { count: 0, items: [] },
  openQuotes: { count: 0 },
};

// Resuelve los IDs de usuario cuyo trabajo puede ver el actual (undefined = todos).
async function resolveOwnerIds(userId: string, role: string): Promise<string[] | undefined> {
  if (OWN_ROLES.includes(role)) return [userId];
  if (TEAM_ROLES.includes(role)) {
    const team = await prisma.user.findMany({ where: { teamLeaderId: userId }, select: { id: true } });
    return [userId, ...team.map((t) => t.id)];
  }
  return undefined; // ADMIN/DIRECTOR/GERENTE/etc → sin restricción
}

export async function getTodayView(userId: string, role: string): Promise<TodayView> {
  try {
    const owners = await resolveOwnerIds(userId, role);
    const ownerWhere = owners ? { in: owners } : undefined;

    const now = new Date();
    const endToday = new Date(now);
    endToday.setHours(23, 59, 59, 999);
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const soon = new Date(now.getTime() + 2 * 60 * 60 * 1000); // SLA en riesgo: vence en <2h

    const contactScope = ownerWhere ? { assignedToId: ownerWhere } : {};
    const dealScope = ownerWhere ? { assignedToId: ownerWhere } : {};
    const activityUserScope = ownerWhere ? { userId: ownerWhere } : {};

    const [
      newLeadsCount, newLeads,
      slaCount, sla,
      tasksCount, tasks,
      convCount, conv,
      visitsCount, visits,
      hotCount, hot,
      openQuotes,
    ] = await Promise.all([
      // 1. Leads nuevos sin tocar
      prisma.contact.count({ where: { deletedAt: null, contactStatus: "NUEVO" as never, ...contactScope } }),
      prisma.contact.findMany({
        where: { deletedAt: null, contactStatus: "NUEVO" as never, ...contactScope },
        select: { id: true, firstName: true, lastName: true, phone: true, leadSource: true },
        orderBy: { createdAt: "desc" }, take: 6,
      }),
      // 2. SLA en riesgo (corriendo y por vencer)
      prisma.slaTimer.count({ where: { status: "RUNNING" as never, dueAt: { lte: soon }, contact: contactScope } }),
      prisma.slaTimer.findMany({
        where: { status: "RUNNING" as never, dueAt: { lte: soon }, contact: contactScope },
        select: { id: true, dueAt: true, type: true, contact: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { dueAt: "asc" }, take: 6,
      }),
      // 3. Tareas vencidas o de hoy
      prisma.activity.count({
        where: { deletedAt: null, activityType: "TASK" as never, status: "PENDIENTE" as never, dueDate: { lte: endToday }, ...activityUserScope },
      }),
      prisma.activity.findMany({
        where: { deletedAt: null, activityType: "TASK" as never, status: "PENDIENTE" as never, dueDate: { lte: endToday }, ...activityUserScope },
        select: { id: true, subject: true, dueDate: true, contact: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { dueDate: "asc" }, take: 6,
      }),
      // 4. Conversaciones sin responder
      prisma.conversation.count({ where: { unreadCount: { gt: 0 }, status: { not: "CLOSED" as never }, contact: contactScope } }),
      prisma.conversation.findMany({
        where: { unreadCount: { gt: 0 }, status: { not: "CLOSED" as never }, contact: contactScope },
        select: { id: true, unreadCount: true, lastInboundAt: true, contact: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { lastInboundAt: "desc" }, take: 6,
      }),
      // 5. Visitas de hoy
      prisma.activity.count({
        where: { deletedAt: null, activityType: { in: ["MEETING_PRESENTIAL", "MEETING_VIRTUAL", "MEETING_SHOWROOM"] as never }, dueDate: { gte: startToday, lte: endToday }, ...activityUserScope },
      }),
      prisma.activity.findMany({
        where: { deletedAt: null, activityType: { in: ["MEETING_PRESENTIAL", "MEETING_VIRTUAL", "MEETING_SHOWROOM"] as never }, dueDate: { gte: startToday, lte: endToday }, ...activityUserScope },
        select: { id: true, subject: true, dueDate: true, contact: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { dueDate: "asc" }, take: 6,
      }),
      // 6. Deals calientes (contacto HOT, no cerrados)
      prisma.deal.count({
        where: { deletedAt: null, stage: { notIn: ["WON", "LOST", "FROZEN"] as never }, contact: { temperature: "HOT" as never }, ...dealScope },
      }),
      prisma.deal.findMany({
        where: { deletedAt: null, stage: { notIn: ["WON", "LOST", "FROZEN"] as never }, contact: { temperature: "HOT" as never }, ...dealScope },
        select: { id: true, stage: true, estimatedValue: true, currency: true, contact: { select: { firstName: true, lastName: true } } },
        orderBy: { updatedAt: "desc" }, take: 6,
      }),
      // 7. Cotizaciones abiertas (enviadas / vistas)
      prisma.quote.count({
        where: { deletedAt: null, status: { in: ["SENT", "OPENED"] as never }, ...(ownerWhere ? { deal: { assignedToId: ownerWhere } } : {}) },
      }),
    ]);

    const name = (c?: { firstName: string; lastName: string } | null) =>
      c ? `${c.firstName} ${c.lastName}` : "—";

    return {
      newLeads: {
        count: newLeadsCount,
        items: newLeads.map((c) => ({ id: c.id, title: `${c.firstName} ${c.lastName}`, subtitle: c.phone, href: `/contacts/${c.id}` })),
      },
      slaAtRisk: {
        count: slaCount,
        items: sla.map((s) => ({ id: s.id, title: name(s.contact), subtitle: s.type as string, meta: s.dueAt.toISOString(), href: s.contact ? `/contacts/${s.contact.id}` : undefined })),
      },
      tasks: {
        count: tasksCount,
        items: tasks.map((t) => ({ id: t.id, title: t.subject, subtitle: name(t.contact), meta: t.dueDate?.toISOString(), href: t.contact ? `/contacts/${t.contact.id}` : undefined })),
      },
      conversations: {
        count: convCount,
        items: conv.map((c) => ({ id: c.id, title: name(c.contact), subtitle: `${c.unreadCount} sin leer`, meta: c.lastInboundAt?.toISOString(), href: "/inbox" })),
      },
      visits: {
        count: visitsCount,
        items: visits.map((v) => ({ id: v.id, title: v.subject, subtitle: name(v.contact), meta: v.dueDate?.toISOString(), href: v.contact ? `/contacts/${v.contact.id}` : undefined })),
      },
      hotDeals: {
        count: hotCount,
        items: hot.map((d) => ({ id: d.id, title: name(d.contact), subtitle: d.stage as string, meta: `${Number(d.estimatedValue).toLocaleString("es-MX")} ${d.currency}`, href: `/pipeline?dealId=${d.id}` })),
      },
      openQuotes: { count: openQuotes },
    };
  } catch (err) {
    console.error("[today] getTodayView falló:", err);
    return EMPTY;
  }
}

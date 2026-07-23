// ============================================================
// API Route: /api/contacts/[id]/timeline
// Cronología unificada de un contacto: cambios de campo (RecordFieldChange,
// tabla aún no migrada → degrada con fieldChangesAvailable:false), actividades,
// mensajes, inscripciones a cadencias y el evento de creación del contacto.
// GET - Página de la cronología (merge-sort desc por fecha con cursor).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { getContactAccessInfo } from "@/server/contacts";
import { mergeTimeline } from "@/lib/timeline/merge";
import { fieldChangeTitle } from "@/lib/timeline/format";
import { ACTIVITY_TYPE_LABELS, LEAD_SOURCE_LABELS } from "@/lib/constants";
import type { TimelineItem, TimelineItemKind } from "@/lib/timeline/types";

// Etiqueta legible del `source` de un RecordFieldChange (ver migración cronología §change-context).
const SOURCE_LABELS: Record<string, string> = {
  ui: "Manual",
  bot_playbook: "Bot",
  routing: "Ruteo automático",
  merge: "Fusión de duplicados",
  zapier: "Zapier",
  lifecycle_auto: "Ciclo de vida (auto)",
  lifecycle_manual: "Ciclo de vida (manual)",
};

function sourceLabel(source: string | null): string {
  if (!source) return "Sistema";
  if (source === "workflow" || source.startsWith("workflow:")) return "Regla de flujo";
  return SOURCE_LABELS[source] ?? source;
}

const MESSAGE_CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  INSTAGRAM: "Instagram",
  MESSENGER: "Messenger",
};

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const access = await getContactAccessInfo(params.id, session as any);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.reason === "not_found" ? "Contacto no encontrado" : "No tienes acceso a este contacto" },
        { status: access.reason === "not_found" ? 404 : 403 }
      );
    }
    const contact = access.contact;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "30", 10) || 30));
    const before = searchParams.get("before") || undefined;
    const beforeDate = before ? new Date(before) : undefined;

    const kindsParam = searchParams.get("kinds");
    const kindsFilter = kindsParam
      ? new Set(kindsParam.split(",").map((k) => k.trim()).filter(Boolean))
      : null;
    const wantsKind = (k: TimelineItemKind) => !kindsFilter || kindsFilter.has(k);

    const sources: TimelineItem[][] = [];
    let fieldChangesAvailable = true;

    // --- RecordFieldChange (tabla puede no existir aún — migración pendiente) ---
    if (wantsKind("field_change")) {
      try {
        const changes = await prisma.recordFieldChange.findMany({
          where: {
            entityType: "contact",
            entityId: contact.id,
            ...(beforeDate ? { changedAt: { lt: beforeDate } } : {}),
          },
          orderBy: { changedAt: "desc" },
          take: limit,
        });

        // Batch de nombres: actorId + (para assignedToId) los ids old/new.
        const userIds = new Set<string>();
        for (const c of changes) {
          if (c.actorId) userIds.add(c.actorId);
          if (c.field === "assignedToId") {
            if (typeof c.oldValue === "string") userIds.add(c.oldValue);
            if (typeof c.newValue === "string") userIds.add(c.newValue);
          }
        }
        const users = userIds.size
          ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } })
          : [];
        const nameById = new Map(users.map((u) => [u.id, u.name]));

        sources.push(
          changes.map((c) => {
            let oldForTitle: unknown = c.oldValue;
            let newForTitle: unknown = c.newValue;
            if (c.field === "assignedToId") {
              oldForTitle = c.oldValue
                ? nameById.get(c.oldValue as string) ?? "Usuario desconocido"
                : "Sin asignar";
              newForTitle = c.newValue
                ? nameById.get(c.newValue as string) ?? "Usuario desconocido"
                : "Sin asignar";
            }
            return {
              id: `fc_${c.id}`,
              ts: c.changedAt.toISOString(),
              kind: "field_change" as const,
              title: fieldChangeTitle(c.field, oldForTitle, newForTitle),
              actorName: c.actorId ? nameById.get(c.actorId) ?? undefined : undefined,
              source: sourceLabel(c.source),
              meta: { field: c.field },
            };
          })
        );
      } catch {
        // La migración de record_field_changes aún no se aplicó en esta BD.
        fieldChangesAvailable = false;
      }
    }

    // --- Activity ---
    if (wantsKind("activity")) {
      const activities = await prisma.activity.findMany({
        where: {
          contactId: contact.id,
          deletedAt: null,
          ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
        },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      sources.push(
        activities.map((a) => ({
          id: `act_${a.id}`,
          ts: a.createdAt.toISOString(),
          kind: "activity" as const,
          title: a.subject || ACTIVITY_TYPE_LABELS[a.activityType] || a.activityType,
          detail: a.description ?? undefined,
          actorName: a.user?.name ?? undefined,
          meta: { activityType: a.activityType },
        }))
      );
    }

    // --- Message (WhatsApp/SMS/Instagram/Messenger) ---
    if (wantsKind("message")) {
      const messages = await prisma.message.findMany({
        where: {
          contactId: contact.id,
          ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      sources.push(
        messages.map((m) => {
          const channelLabel = MESSAGE_CHANNEL_LABELS[m.channel] ?? m.channel;
          const dirLabel = m.direction === "INBOUND" ? "entrante" : "saliente";
          const body = m.body ?? "";
          return {
            id: `msg_${m.id}`,
            ts: m.createdAt.toISOString(),
            kind: "message" as const,
            title: `${channelLabel} ${dirLabel}`,
            detail: body.length > 140 ? `${body.slice(0, 140)}…` : body || undefined,
            meta: { channel: m.channel, direction: m.direction },
          };
        })
      );
    }

    // --- ActionPlanEnrollment: hasta 2 items por inscripción (entrada + salida) ---
    if (wantsKind("enrollment")) {
      const enrollments = await prisma.actionPlanEnrollment.findMany({
        where: { entityType: "contact", entityId: contact.id },
        include: { plan: { select: { name: true } } },
        orderBy: { enrolledAt: "desc" },
      });

      const enrollmentItems: TimelineItem[] = [];
      for (const e of enrollments) {
        enrollmentItems.push({
          id: `enr_${e.id}_in`,
          ts: e.enrolledAt.toISOString(),
          kind: "enrollment",
          title: `Inscrito en la cadencia ${e.plan.name}`,
          meta: { planId: e.planId, status: e.status },
        });
        if (e.exitedAt) {
          enrollmentItems.push({
            id: `enr_${e.id}_out`,
            ts: e.exitedAt.toISOString(),
            kind: "enrollment",
            title: `Salió de la cadencia ${e.plan.name} (${e.status})`,
            meta: { planId: e.planId, status: e.status },
          });
        }
      }
      sources.push(enrollmentItems);
    }

    // --- contact.createdAt: se posiciona sola en el merge; solo aparece cuando la
    // paginación llega al fondo de la cronología (es el evento más antiguo posible). ---
    if (wantsKind("created")) {
      const sourceLbl = LEAD_SOURCE_LABELS[contact.leadSource] ?? contact.leadSource;
      sources.push([
        {
          id: `created_${contact.id}`,
          ts: contact.createdAt.toISOString(),
          kind: "created",
          title: "Contacto creado",
          detail: sourceLbl ? `Fuente: ${sourceLbl}` : undefined,
        },
      ]);
    }

    const { items, nextCursor } = mergeTimeline(sources, limit, before);

    return NextResponse.json({ items, nextCursor, fieldChangesAvailable });
  } catch (error) {
    console.error("Error al obtener cronología del contacto:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

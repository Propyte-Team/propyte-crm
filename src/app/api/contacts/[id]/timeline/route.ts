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
import { nombreDeContacto } from "@/lib/contacts/referidos";
import { mergeTimeline } from "@/lib/timeline/merge";
import { fieldChangeTitle } from "@/lib/timeline/format";
import { cambiosCustomVisibles } from "@/lib/timeline/custom";
import { ACTIVITY_TYPE_LABELS, LEAD_SOURCE_LABELS } from "@/lib/constants";
import type { TimelineItem, TimelineItemKind } from "@/lib/timeline/types";

// Etiqueta legible del `source` de un RecordFieldChange (ver migración cronología §change-context).
const SOURCE_LABELS: Record<string, string> = {
  ui: "Manual",
  bot_playbook: "Bot",
  routing: "Ruteo automático",
  // #748 (2026-10-14): el reparto usó la marca de la cuenta (su plaza predeterminada o, sin
  // asesor en la plaza, su responsable de marketing). Distinto de "routing" a propósito.
  routing_marca: "Ruteo automático (marca de la cuenta)",
  merge: "Fusión de duplicados",
  // #883 (2026-10-14): «Seleccionar todos → Asignar a…» del panel de leads huérfanos.
  orphan_bulk_assign: "Asignación masiva (leads huérfanos)",
  zapier: "Zapier",
  lifecycle_auto: "Ciclo de vida (auto)",
  lifecycle_manual: "Ciclo de vida (manual)",
  // Perfil (plazo, pago, interés, presupuesto) copiado del formulario de Meta guardado en el Hub.
  // Ver lib/intake/perfil-desde-hub.ts.
  perfil_meta_hub: "Formulario de Meta (Hub)",
  // #933: salían crudos («· bot_classifier»).
  bot_classifier: "Bot (clasificador)",
  social_profile: "Perfil de redes sociales",
  // #934: las que seguían crudas (medido el 27-oct sobre record_field_changes).
  // Nombre/apellido/teléfono/correo tomados del resumen del formulario de anuncio que llega
  // en el texto del DM (lib/messaging/lead-form-summary).
  lead_form_summary: "Formulario del anuncio (Messenger)",
  inbox_spam: "Inbox (marcado como spam)",
  inbox_assign: "Inbox (asignación)",
  limpieza_contactos_2026_10_16: "Limpieza de contactos (16-oct)",
  // #948: la migración llenó el flujo de los casos seguros (Broker → F6, Empleo → F8).
  flujo_llenado_2026_10_29: "Llenado de flujo (29-oct)",
  // #938: la migración pasó Lead, Comprador e Inversionista a «Lead Comprador».
  tipos_lead_comprador_938: "Cambio de tipos (Lead Comprador)",
};

/** «nueva_fuente» → «Nueva fuente»: una fuente sin etiqueta nunca sale como identificador. */
function fuenteAPalabras(source: string): string {
  const t = source.replace(/[_:-]+/g, " ").trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : source;
}

function sourceLabel(source: string | null): string {
  if (!source) return "Sistema";
  if (source === "workflow" || source.startsWith("workflow:")) return "Regla de flujo";
  return SOURCE_LABELS[source] ?? fuenteAPalabras(source);
}

const MESSAGE_CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  INSTAGRAM: "Instagram",
  MESSENGER: "Messenger",
};

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
        // #933: los cambios de `custom` que solo tocan claves internas (la clasificación del
        // bot, la foto de perfil, el rastro de Meta/Zoho…) no se muestran, y eran ~85% de los
        // de `custom`. Filtrarlos DESPUÉS de un `take: limit` rompería la paginación: esta fuente
        // devolvería menos de lo que hay y el cursor del merge podría saltarse cambios reales.
        // Por eso se piden lotes hasta juntar `limit` renglones VISIBLES (o acabar), con tope.
        const LOTE = Math.max(limit * 2, 100);
        const MAX_LOTES = 10;
        const whereCambios = {
          entityType: "contact",
          entityId: contact.id,
          ...(beforeDate ? { changedAt: { lt: beforeDate } } : {}),
        };
        type Cambio = Awaited<ReturnType<typeof prisma.recordFieldChange.findMany>>[number];
        const changes: Cambio[] = [];
        let visibles = 0;
        for (let lote = 0; lote < MAX_LOTES && visibles < limit; lote++) {
          const pagina = await prisma.recordFieldChange.findMany({
            where: whereCambios,
            // id como desempate: varias filas comparten el mismo instante (un UPDATE masivo).
            orderBy: [{ changedAt: "desc" }, { id: "desc" }],
            skip: lote * LOTE,
            take: LOTE,
          });
          for (const c of pagina) {
            const n = c.field === "custom" ? cambiosCustomVisibles(c.oldValue, c.newValue).length : 1;
            if (n === 0) continue;
            changes.push(c);
            visibles += n;
            if (visibles >= limit) break;
          }
          if (pagina.length < LOTE) break;
        }

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

        // #907: «Referido por» guarda el id de un CONTACTO (el broker), no de un usuario.
        const brokerIds = new Set<string>();
        for (const c of changes) {
          if (c.field !== "referredById") continue;
          if (typeof c.oldValue === "string") brokerIds.add(c.oldValue);
          if (typeof c.newValue === "string") brokerIds.add(c.newValue);
        }
        const brokers = brokerIds.size
          ? await prisma.contact.findMany({
              where: { id: { in: [...brokerIds] } },
              select: { id: true, firstName: true, lastName: true },
            })
          : [];
        const brokerById = new Map(brokers.map((b) => [b.id, nombreDeContacto(b)]));

        // #949: «Empresa» guarda el id de una empresa (developer_partners). Incluye las borradas:
        // la cronología cuenta lo que pasó, aunque la empresa ya no exista.
        const empresaIds = new Set<string>();
        for (const c of changes) {
          if (c.field !== "developerPartnerId") continue;
          if (typeof c.oldValue === "string") empresaIds.add(c.oldValue);
          if (typeof c.newValue === "string") empresaIds.add(c.newValue);
        }
        const empresas = empresaIds.size
          ? await prisma.developerPartner.findMany({
              where: { id: { in: [...empresaIds] } },
              select: { id: true, name: true },
            })
          : [];
        const empresaById = new Map(empresas.map((e) => [e.id, e.name]));

        // #937: «Campaña o evento» guarda el id de lead_campaigns (incluye las archivadas).
        const campanaIds = new Set<string>();
        for (const c of changes) {
          if (c.field !== "campaignId") continue;
          if (typeof c.oldValue === "string") campanaIds.add(c.oldValue);
          if (typeof c.newValue === "string") campanaIds.add(c.newValue);
        }
        const campanas = campanaIds.size
          ? await prisma.leadCampaign.findMany({
              where: { id: { in: [...campanaIds] } },
              select: { id: true, name: true },
            })
          : [];
        const campanaById = new Map(campanas.map((e) => [e.id, e.name]));

        sources.push(
          changes.flatMap((c) => {
            const comun = {
              ts: c.changedAt.toISOString(),
              kind: "field_change" as const,
              actorName: c.actorId ? nameById.get(c.actorId) ?? undefined : undefined,
              source: sourceLabel(c.source),
              meta: { field: c.field },
            };
            // #933: un renglón por dato de negocio que cambió; nunca «[object Object]».
            if (c.field === "custom") {
              return cambiosCustomVisibles(c.oldValue, c.newValue).map((k) => ({
                ...comun,
                id: `fc_${c.id}_${k.clave}`,
                title: `${k.etiqueta} se actualizó de ${k.antes} a ${k.despues}`,
              }));
            }
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
            if (c.field === "referredById") {
              oldForTitle = c.oldValue
                ? brokerById.get(c.oldValue as string) ?? "Contacto desconocido"
                : "Nadie";
              newForTitle = c.newValue
                ? brokerById.get(c.newValue as string) ?? "Contacto desconocido"
                : "Nadie";
            }
            if (c.field === "developerPartnerId") {
              oldForTitle = c.oldValue
                ? empresaById.get(c.oldValue as string) ?? "Empresa desconocida"
                : "Ninguna";
              newForTitle = c.newValue
                ? empresaById.get(c.newValue as string) ?? "Empresa desconocida"
                : "Ninguna";
            }
            if (c.field === "campaignId") {
              oldForTitle = c.oldValue
                ? campanaById.get(c.oldValue as string) ?? "Campaña desconocida"
                : "Ninguna";
              newForTitle = c.newValue
                ? campanaById.get(c.newValue as string) ?? "Campaña desconocida"
                : "Ninguna";
            }
            return [
              {
                ...comun,
                id: `fc_${c.id}`,
                title: fieldChangeTitle(c.field, oldForTitle, newForTitle),
              },
            ];
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

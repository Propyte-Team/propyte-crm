// ActionRunner — ejecutores por WorkflowActionType (Anexo Técnico §D.3).
// Toda acción respeta doNotContact/whatsappOptOut y deja rastro (Activity/Notification).
// AI_*: pasa por el bot (Fase 4); si no hay API key o el hilo está en HUMAN → SKIPPED con nota.
import prisma from "@/lib/db";
import type { ActionQueue, Contact } from "@prisma/client";
import { sendWhatsAppMessage } from "@/lib/twilio/whatsapp";
import { autoRouteLead } from "./routing";

export interface ActionResult {
  skipped?: boolean;
  note?: string;
}

async function loadContact(item: ActionQueue): Promise<Contact | null> {
  if (item.entityType === "contact") {
    return prisma.contact.findUnique({ where: { id: item.entityId } });
  }
  if (item.entityType === "deal") {
    const deal = await prisma.deal.findUnique({ where: { id: item.entityId }, select: { contactId: true } });
    if (!deal) return null;
    return prisma.contact.findUnique({ where: { id: deal.contactId } });
  }
  return null;
}

// Usuario "dueño" para acciones que necesitan userId (Activity/Notification)
async function ownerUserId(contact: Contact | null): Promise<string | null> {
  if (contact?.assignedToId) return contact.assignedToId;
  const admin = await prisma.user.findFirst({
    where: { role: { in: ["ADMIN", "DIRECTOR", "GERENTE"] }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  return admin?.id ?? null;
}

async function renderTemplateBody(templateRef: string | undefined, contact: Contact | null, language: string): Promise<string | null> {
  if (!templateRef) return null;
  const tpl = await prisma.userTemplate.findFirst({
    where: {
      isActive: true,
      deletedAt: null,
      OR: [{ id: templateRef }, { name: templateRef }],
      language: language === "EN" ? "EN" : "ES",
    },
  });
  if (!tpl) return null;
  let body = tpl.body;
  const vars: Record<string, string> = {
    "contact.firstName": contact?.firstName ?? "",
    "contact.lastName": contact?.lastName ?? "",
  };
  for (const [k, v] of Object.entries(vars)) body = body.replaceAll(`{{${k}}}`, v);
  // Variable sin resolver → quitar la línea completa (J.2: nunca enviar {{...}} crudo)
  body = body
    .split("\n")
    .filter((line) => !/\{\{[^}]+\}\}/.test(line))
    .join("\n")
    .trim();
  return body || null;
}

export async function executeAction(item: ActionQueue): Promise<ActionResult> {
  const config = (item.config ?? {}) as Record<string, unknown>;
  const contact = await loadContact(item);

  switch (item.actionType) {
    case "CREATE_TASK": {
      if (!contact) return { skipped: true, note: "Sin contacto" };
      const userId = await ownerUserId(contact);
      if (!userId) return { skipped: true, note: "Sin usuario destino" };
      const dueInMinutes = typeof config.dueInMinutes === "number" ? config.dueInMinutes : 1440;
      await prisma.activity.create({
        data: {
          contactId: contact.id,
          dealId: item.entityType === "deal" ? item.entityId : undefined,
          userId,
          activityType: "TASK",
          subject: String(config.subject ?? "Tarea de workflow"),
          description: config.description ? String(config.description) : null,
          dueDate: new Date(Date.now() + dueInMinutes * 60_000),
          status: "PENDIENTE",
        },
      });
      return {};
    }

    case "NOTIFY": {
      if (!contact) return { skipped: true, note: "Sin contacto" };
      const userId = await ownerUserId(contact);
      if (!userId) return { skipped: true, note: "Sin usuario destino" };
      await prisma.notification.create({
        data: {
          userId,
          title: String(config.title ?? "Workflow"),
          message: String(config.message ?? config.template ?? "Acción de workflow"),
          type: String(config.type ?? "workflow"),
          link: contact ? `/contacts/${contact.id}` : null,
        },
      });
      return {};
    }

    case "ASSIGN":
    case "REASSIGN": {
      if (!contact) return { skipped: true, note: "Sin contacto" };
      if (item.actionType === "ASSIGN" && contact.assignedToId) {
        return { skipped: true, note: "Ya asignado" };
      }
      await autoRouteLead(contact.id, { reason: String(config.reason ?? item.actionType.toLowerCase()) });
      return {};
    }

    case "UPDATE_FIELD": {
      if (!contact) return { skipped: true, note: "Sin contacto" };
      const field = String(config.field ?? "");
      const allowed = ["temperature", "contactStatus", "urgency"]; // whitelist deliberada
      if (!allowed.includes(field)) return { skipped: true, note: `Campo no permitido: ${field}` };
      await prisma.contact.update({ where: { id: contact.id }, data: { [field]: config.value } as never });
      return {};
    }

    case "ADD_TAG": {
      if (!contact) return { skipped: true, note: "Sin contacto" };
      const tag = String(config.tag ?? "");
      if (!tag || contact.tags.includes(tag)) return { skipped: true, note: "Tag vacío o existente" };
      await prisma.contact.update({ where: { id: contact.id }, data: { tags: { push: tag } } });
      return {};
    }

    case "CHANGE_STAGE": {
      if (item.entityType !== "deal") return { skipped: true, note: "Solo aplica a deals" };
      const toStage = String(config.toStage ?? "");
      if (!toStage) return { skipped: true, note: "Sin toStage" };
      await prisma.deal.update({ where: { id: item.entityId }, data: { stage: toStage as never } });
      return {};
    }

    case "ENROLL_PLAN": {
      const planId = String(config.planId ?? "");
      if (!planId) return { skipped: true, note: "Sin planId" };
      const { enrollInPlan } = await import("./scheduler");
      const enrolled = await enrollInPlan(planId, item.entityType, item.entityId);
      return enrolled ? {} : { skipped: true, note: "Ya enrolado o plan inactivo" };
    }

    case "ESCALATE": {
      if (!contact) return { skipped: true, note: "Sin contacto" };
      // Escala a la cadena: TEAM_LEADER del asesor → GERENTE/DIRECTOR
      const advisor = contact.assignedToId
        ? await prisma.user.findUnique({ where: { id: contact.assignedToId }, select: { teamLeaderId: true } })
        : null;
      const targets = advisor?.teamLeaderId
        ? [advisor.teamLeaderId]
        : (
            await prisma.user.findMany({
              where: { role: { in: ["GERENTE", "DIRECTOR", "ADMIN"] }, isActive: true, deletedAt: null },
              select: { id: true },
              take: 3,
            })
          ).map((u) => u.id);
      for (const userId of targets) {
        await prisma.notification.create({
          data: {
            userId,
            title: "Escalamiento",
            message: `${contact.firstName} ${contact.lastName}: ${String(config.reason ?? config.to ?? "requiere atención")}`,
            type: "escalation",
            link: `/contacts/${contact.id}`,
          },
        });
      }
      return {};
    }

    case "SEND_WHATSAPP": {
      if (!contact) return { skipped: true, note: "Sin contacto" };
      if (contact.doNotContact || contact.whatsappOptOut) return { skipped: true, note: "Opt-out" };
      // Si el hilo está en manos de un humano, las cadencias L2 no interfieren (§I.7)
      const conv = await prisma.conversation.findUnique({
        where: { contactId_channel: { contactId: contact.id, channel: "WHATSAPP" } },
        select: { status: true },
      });
      if (conv?.status === "HUMAN") return { skipped: true, note: "Conversación en control humano" };
      const body =
        (await renderTemplateBody(config.template as string | undefined, contact, contact.preferredLanguage)) ??
        (typeof config.body === "string" ? config.body : null);
      if (!body) return { skipped: true, note: "Sin plantilla ni body" };
      const userId = await ownerUserId(contact);
      if (!userId) return { skipped: true, note: "Sin usuario emisor" };
      await sendWhatsAppMessage(contact.phone, body, contact.id, userId);
      return {};
    }

    case "SEND_EMAIL": {
      if (!contact?.email) return { skipped: true, note: "Contacto sin email" };
      if (contact.doNotContact) return { skipped: true, note: "Opt-out" };
      // El envío real de email de cadencia llega con Perfiles (F5: firma + From alias).
      return { skipped: true, note: "SEND_EMAIL se habilita con F5 (firma/alias)" };
    }

    case "AI_REPLY":
    case "AI_DRAFT":
    case "AI_CALL_SUMMARY": {
      if (!contact) return { skipped: true, note: "Sin contacto" };
      if (contact.doNotContact || contact.whatsappOptOut) return { skipped: true, note: "Opt-out" };
      const { runAiAction } = await import("@/lib/bot/ai-actions");
      return runAiAction(item.actionType, contact, config);
    }

    case "MAKE_CALL":
      return { skipped: true, note: "Dialer disponible en fase posterior (voz)" };

    case "WEBHOOK": {
      const url = String(config.url ?? "");
      if (!url.startsWith("https://")) return { skipped: true, note: "URL inválida" };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: item.entityType, entityId: item.entityId, config }),
      });
      if (!res.ok) throw new Error(`Webhook ${url} → ${res.status}`);
      return {};
    }

    default:
      return { skipped: true, note: `Acción no implementada: ${item.actionType}` };
  }
}

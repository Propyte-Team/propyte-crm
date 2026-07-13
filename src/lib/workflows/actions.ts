// ActionRunner — ejecutores por WorkflowActionType (Anexo Técnico §D.3).
// Toda acción respeta doNotContact/whatsappOptOut y deja rastro (Activity/Notification).
// AI_*: pasa por el bot (Fase 4); si no hay API key o el hilo está en HUMAN → SKIPPED con nota.
import prisma from "@/lib/db";
import type { ActionQueue, Contact } from "@prisma/client";
import { sendWhatsAppMessage } from "@/lib/twilio/whatsapp";
import { autoRouteLead } from "./routing";
import { resolveEmailContent, resolveEmailSender, plainToHtml } from "@/lib/email/compose";
import { sendSmtpEmail } from "@/lib/email/mailer";
import { sendGmail } from "@/lib/google/gmail";
import { getConnectionStatus } from "@/lib/google/workspace.service";
import { withChangeSource } from "@/lib/audit/change-context";

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
  // Cronología: identifica la regla de origen cuando está disponible (barato — ya viene en item).
  const workflowSource = item.ruleId ? `workflow:${item.ruleId}` : "workflow";

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
      const value = config.value;
      // Whitelist deliberada — incluye segmentación (contactType/leadSource) para reglas tipo Zoho.
      const allowed = ["temperature", "contactStatus", "urgency", "contactType", "leadSource"];
      if (!allowed.includes(field)) return { skipped: true, note: `Campo no permitido: ${field}` };
      // Validar enums: un valor inválido NO debe romper el update (Prisma lanzaría).
      const ENUMS: Record<string, string[]> = {
        contactType: ["LEAD","PROSPECTO","CLIENTE","INVERSIONISTA","BROKER_EXTERNO","REFERIDO","EMPLEO","COMPRADOR","REFERIDOR"],
        leadSource: [
          "WALK_IN", "FACEBOOK_ADS", "GOOGLE_ADS", "INSTAGRAM", "TIKTOK_ADS", "PORTAL_INMOBILIARIO",
          "REFERIDO_CLIENTE", "REFERIDO_BROKER", "LLAMADA_FRIA", "EVENTO", "WEBSITE", "WHATSAPP",
          "MESSENGER", "META_ADS", "BASE_DE_DATOS", "SELF_GEN", "REGISTRO_BROKER", "WEBINAR",
          "LINKEDIN", "OTRO", "LLAMADA_ENTRANTE",
        ],
      };
      if (ENUMS[field] && !ENUMS[field].includes(String(value))) {
        return { skipped: true, note: `Valor inválido para ${field}: ${String(value)}` };
      }
      await withChangeSource(
        { source: workflowSource },
        (tx) => tx.contact.update({ where: { id: contact.id }, data: { [field]: value } as never })
      );
      return {};
    }

    case "ADD_TAG": {
      if (!contact) return { skipped: true, note: "Sin contacto" };
      const tag = String(config.tag ?? "");
      if (!tag || contact.tags.includes(tag)) return { skipped: true, note: "Tag vacío o existente" };
      await withChangeSource(
        { source: workflowSource },
        (tx) => tx.contact.update({ where: { id: contact.id }, data: { tags: { push: tag } } })
      );
      return {};
    }

    case "CHANGE_STAGE": {
      if (item.entityType !== "deal") return { skipped: true, note: "Solo aplica a deals" };
      const toStage = String(config.toStage ?? "");
      if (!toStage) return { skipped: true, note: "Sin toStage" };
      await prisma.deal.update({ where: { id: item.entityId }, data: { stage: toStage as never } });
      return {};
    }

    case "SET_LIFECYCLE": {
      if (!contact) return { skipped: true, note: "Sin contacto" };
      const toStage = String(config.toStage ?? "");
      const STAGES = ["SUSCRIPTOR","LEAD","MQL","SQL","OPORTUNIDAD","CLIENTE","EMBAJADOR"];
      if (!STAGES.includes(toStage)) return { skipped: true, note: `Etapa inválida: ${toStage}` };
      const { applyLifecycleTransition } = await import("@/lib/lifecycle/apply");
      const res = await applyLifecycleTransition({
        contactId: contact.id, from: contact.lifecycleStage, to: toStage as never,
        auto: config.allowBackward === true ? false : true,
        actorUserId: contact.assignedToId ?? null,
      });
      return res.applied ? {} : { skipped: true, note: res.note };
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
      const { findConversationForChannel } = await import("@/lib/messaging/conversations");
      const conv = await findConversationForChannel(contact.id, "WHATSAPP");
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

      const templateRef = typeof config.template === "string" ? config.template : undefined;
      const tpl = templateRef
        ? await prisma.userTemplate.findFirst({
            where: {
              isActive: true,
              deletedAt: null,
              channel: "EMAIL",
              OR: [{ id: templateRef }, { name: templateRef }],
              language: contact.preferredLanguage === "EN" ? "EN" : "ES",
            },
            select: { subject: true, body: true },
          })
        : null;

      const vars: Record<string, string> = {
        "contact.firstName": contact.firstName ?? "",
        "contact.lastName": contact.lastName ?? "",
      };
      const content = resolveEmailContent({
        template: tpl,
        configSubject: config.subject,
        configBody: config.body,
        vars,
      });
      if (!content) return { skipped: true, note: "SEND_EMAIL sin contenido (plantilla o subject/body)" };

      const owner = await ownerUserId(contact);
      const sender = await resolveEmailSender(owner, async (uid) => {
        const st = await getConnectionStatus(uid).catch(() => null);
        return Boolean(st?.connected);
      });

      // emailSignatureHtml ya es HTML: NO debe pasar por plainToHtml (que escapa). Se concatena crudo.
      const profile = sender.userId
        ? await prisma.userProfile
            .findUnique({ where: { userId: sender.userId }, select: { emailSignatureHtml: true } })
            .catch(() => null)
        : null;
      const sigHtml = profile?.emailSignatureHtml?.trim() || "";
      const html = plainToHtml(content.body) + (sigHtml ? `<br><br>${sigHtml}` : "");

      if (sender.kind === "gmail" && sender.userId) {
        await sendGmail({ userId: sender.userId, to: contact.email, subject: content.subject, html });
        return {}; // sendGmail logs the outbound to the contact's thread
      }

      const ownerName = sender.userId
        ? (
            await prisma.user
              .findUnique({ where: { id: sender.userId }, select: { name: true } })
              .catch(() => null)
          )?.name ?? undefined
        : undefined;
      await sendSmtpEmail({ to: contact.email, subject: content.subject, html, fromName: ownerName });
      if (sender.userId) {
        await prisma.activity
          .create({
            data: {
              contactId: contact.id,
              userId: sender.userId,
              activityType: "EMAIL_SENT",
              subject: content.subject,
              description: content.body,
              status: "PENDIENTE",
            },
          })
          .catch(() => null);
      }
      return {};
    }

    case "AI_REPLY":
    case "AI_DRAFT":
    case "AI_CALL_SUMMARY": {
      if (!contact) return { skipped: true, note: "Sin contacto" };
      if (contact.doNotContact || contact.whatsappOptOut) return { skipped: true, note: "Opt-out" };
      const { runAiAction } = await import("@/lib/bot/ai-actions");
      return runAiAction(item.actionType, contact, config);
    }

    case "MAKE_CALL": {
      if (!contact) return { skipped: true, note: "Sin contacto" };
      if (!contact.phone) return { skipped: true, note: "Contacto sin teléfono" };
      if (contact.doNotContact) return { skipped: true, note: "Opt-out" };
      const userId = await ownerUserId(contact);
      if (!userId) return { skipped: true, note: "Sin usuario destino" };

      const subject = String(config.subject ?? `Llamar a ${contact.firstName ?? "contacto"}`);
      const dueInMinutes = typeof config.dueInMinutes === "number" ? config.dueInMinutes : 60;
      await prisma.activity.create({
        data: {
          contactId: contact.id,
          dealId: item.entityType === "deal" ? item.entityId : undefined,
          userId,
          activityType: "CALL_TASK",
          subject,
          description: config.reason ? String(config.reason) : (config.description ? String(config.description) : null),
          dueDate: new Date(Date.now() + dueInMinutes * 60_000),
          status: "PENDIENTE",
        },
      });
      await prisma.notification.create({
        data: {
          userId,
          title: "Llamada pendiente",
          message: subject,
          type: "call_task",
          link: `/contacts/${contact.id}`,
        },
      });
      return {};
    }

    case "GW_GMAIL_LOG_INBOUND": {
      // Disparado por webhook Pub/Sub o cron: corre el delta sync del buzón del asesor.
      const userId = String(config.userId ?? "");
      if (!userId) return { skipped: true, note: "Sin userId" };
      const { processGmailHistory } = await import("@/lib/google/gmail");
      const r = await processGmailHistory(userId);
      return { note: `gmail inbound: ${r.logged} logueados, ${r.skipped} omitidos` };
    }

    case "GW_GMAIL_LOG_OUTBOUND": {
      // Log diferido de un saliente por messageId (respaldo si el log inline del envío falló).
      const userId = String(config.userId ?? "");
      const messageId = String(config.messageId ?? "");
      if (!userId || !messageId) return { skipped: true, note: "Faltan userId/messageId" };
      const { logGmailMessageById } = await import("@/lib/google/gmail");
      const ok = await logGmailMessageById(userId, messageId);
      return ok ? {} : { skipped: true, note: "No logueado (sin match o duplicado)" };
    }

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

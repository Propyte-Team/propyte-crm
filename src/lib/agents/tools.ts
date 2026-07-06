// Registry de herramientas del CRM para agentes (speckit #4 §2.4) — base del futuro MCP.
// Cada tool: schema de entrada (formato Claude tool-use), roles permitidos, y handler que
// valida RBAC del systemUser del agente + opt-out (PA1/PA2). Todo uso → Activity/AuditLog.
import prisma from "@/lib/db";
import type { User } from "@prisma/client";
import { normalizePhoneE164 } from "@/lib/phone";

export interface AgentTool {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  allowedRoles: string[]; // RBAC: el systemUser del agente debe tener uno de estos roles
  handler: (input: Record<string, unknown>, systemUser: User) => Promise<unknown>;
}

const ADVISOR_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER", "ASESOR", "ASESOR_SR", "ASESOR_JR", "MARKETING"];

async function auditToolUse(systemUser: User, tool: string, input: unknown): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: systemUser.id,
      action: "UPDATE",
      entity: "AgentTool",
      entityId: tool,
      changes: JSON.parse(JSON.stringify({ input })),
    },
  }).catch(() => {});
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "search_contacts",
    description: "Busca contactos por nombre, teléfono o email. Devuelve hasta 5 con su perfil resumido.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    allowedRoles: ADVISOR_ROLES,
    handler: async (input) => {
      const q = String(input.query ?? "");
      const rows = await prisma.contact.findMany({
        where: {
          deletedAt: null,
          mergedIntoId: null,
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { phone: { contains: q.replace(/\D/g, "") || q } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          id: true, firstName: true, lastName: true, phone: true, email: true, score: true,
          temperature: true, contactStatus: true, preferredLanguage: true, budgetMin: true,
          budgetMax: true, preferredZone: true, lastActivityAt: true,
        },
        take: 5,
      });
      return rows;
    },
  },
  {
    name: "get_contact",
    description: "Trae el detalle completo de un contacto por id, con sus deals activos y últimas 10 actividades.",
    input_schema: { type: "object", properties: { contactId: { type: "string" } }, required: ["contactId"] },
    allowedRoles: ADVISOR_ROLES,
    handler: async (input) =>
      prisma.contact.findUnique({
        where: { id: String(input.contactId) },
        include: {
          deals: { where: { deletedAt: null }, select: { id: true, stage: true, estimatedValue: true, dealType: true } },
          activities: { orderBy: { createdAt: "desc" }, take: 10, select: { activityType: true, subject: true, createdAt: true } },
        },
      }),
  },
  {
    name: "update_investment_profile",
    description:
      "Actualiza el perfil de inversión capturado en conversación: presupuesto, zona, horizonte, tipo de propiedad, idioma.",
    input_schema: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        budgetMin: { type: "number" },
        budgetMax: { type: "number" },
        preferredZone: { type: "string" },
        purchaseTimeline: { type: "string", enum: ["IMMEDIATE", "ONE_TO_THREE_MONTHS", "THREE_TO_SIX_MONTHS", "SIX_PLUS_MONTHS"] },
        propertyType: { type: "string", enum: ["DEPARTAMENTO", "CASA", "TERRENO", "MACROLOTE", "LOCAL_COMERCIAL", "OTRO"] },
        preferredLanguage: { type: "string", enum: ["ES", "EN"] },
      },
      required: ["contactId"],
    },
    allowedRoles: ADVISOR_ROLES,
    handler: async (input, systemUser) => {
      const { contactId, ...fields } = input as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      for (const k of ["budgetMin", "budgetMax", "preferredZone", "purchaseTimeline", "propertyType", "preferredLanguage"]) {
        if (fields[k] !== undefined && fields[k] !== null) data[k] = fields[k];
      }
      if (Object.keys(data).length === 0) return { updated: false };
      await prisma.contact.update({ where: { id: String(contactId) }, data: { ...data, lastActivityAt: new Date() } as never });
      await auditToolUse(systemUser, "update_investment_profile", { contactId, ...data });
      return { updated: true, fields: Object.keys(data) };
    },
  },
  {
    name: "match_units",
    description: "Matching invertido: desarrollos del catálogo del Hub que encajan con presupuesto/zona del contacto. ÚNICA fuente válida de precios (data-gate).",
    input_schema: { type: "object", properties: { contactId: { type: "string" } }, required: ["contactId"] },
    allowedRoles: ADVISOR_ROLES,
    handler: async (input) => {
      const contact = await prisma.contact.findUnique({ where: { id: String(input.contactId) } });
      if (!contact) return [];
      const { findMatchingDevelopments } = await import("@/lib/bot/hub-catalog");
      return findMatchingDevelopments({
        budgetMin: contact.budgetMin ? Number(contact.budgetMin) : null,
        budgetMax: contact.budgetMax ? Number(contact.budgetMax) : null,
        zone: contact.preferredZone,
        limit: 3,
      });
    },
  },
  {
    name: "send_whatsapp",
    description:
      "Envía un WhatsApp al contacto. Respeta opt-out y control humano del hilo. El texto pasa por el linter de marca ANTES de salir.",
    input_schema: {
      type: "object",
      properties: { contactId: { type: "string" }, body: { type: "string" } },
      required: ["contactId", "body"],
    },
    allowedRoles: ADVISOR_ROLES,
    handler: async (input, systemUser) => {
      const contact = await prisma.contact.findUnique({ where: { id: String(input.contactId) } });
      if (!contact) return { sent: false, reason: "Contacto no existe" };
      if (contact.doNotContact || contact.whatsappOptOut) return { sent: false, reason: "Opt-out" };
      const { findConversationForChannel } = await import("@/lib/messaging/conversations");
      const conv = await findConversationForChannel(contact.id, "WHATSAPP");
      if (conv?.status === "HUMAN") return { sent: false, reason: "Hilo en control humano" };
      const { lintBrandVoice } = await import("@/lib/bot/brand-linter");
      const lint = lintBrandVoice(String(input.body));
      if (!lint.ok) return { sent: false, reason: `Linter de marca: ${lint.violations.join(", ")}` };
      const { sendWhatsAppMessage } = await import("@/lib/twilio/whatsapp");
      const message = await sendWhatsAppMessage(contact.phone, String(input.body), contact.id, systemUser.id);
      await prisma.message.update({
        where: { id: message.id },
        data: { sender: "BOT", aiGenerated: true, aiAutonomy: "L2" },
      }).catch(() => {});
      return { sent: true };
    },
  },
  {
    name: "create_task",
    description: "Crea una tarea de seguimiento para el asesor asignado del contacto.",
    input_schema: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        subject: { type: "string" },
        dueInHours: { type: "number" },
      },
      required: ["contactId", "subject"],
    },
    allowedRoles: ADVISOR_ROLES,
    handler: async (input, systemUser) => {
      const contact = await prisma.contact.findUnique({ where: { id: String(input.contactId) } });
      if (!contact) return { created: false };
      const userId = contact.assignedToId ?? systemUser.id;
      await prisma.activity.create({
        data: {
          contactId: contact.id,
          userId,
          activityType: "TASK",
          subject: String(input.subject).slice(0, 200),
          dueDate: new Date(Date.now() + (Number(input.dueInHours) || 24) * 3_600_000),
          status: "PENDIENTE",
        },
      });
      return { created: true, assignedTo: userId };
    },
  },
  {
    name: "escalate_to_human",
    description: "Escala al asesor asignado (o coordinación) con un resumen del motivo. Úsalo ante intención fuerte, queja, tema legal/fiscal o cualquier duda.",
    input_schema: {
      type: "object",
      properties: { contactId: { type: "string" }, reason: { type: "string" } },
      required: ["contactId", "reason"],
    },
    allowedRoles: ADVISOR_ROLES,
    handler: async (input, systemUser) => {
      const contact = await prisma.contact.findUnique({ where: { id: String(input.contactId) } });
      if (!contact) return { escalated: false };
      const targetId =
        contact.assignedToId ??
        (await prisma.user.findFirst({ where: { role: { in: ["GERENTE", "DIRECTOR", "ADMIN"] }, isActive: true }, select: { id: true } }))?.id;
      if (!targetId) return { escalated: false };
      await prisma.notification.create({
        data: {
          userId: targetId,
          title: "Agente escaló un contacto",
          message: `${contact.firstName} ${contact.lastName}: ${String(input.reason).slice(0, 180)}`,
          type: "agent_escalation",
          link: `/contacts/${contact.id}`,
        },
      });
      await auditToolUse(systemUser, "escalate_to_human", input);
      return { escalated: true, to: targetId };
    },
  },
  {
    name: "capture_lead",
    description: "Da de alta un lead nuevo (nombre + teléfono o email). Corre dedup, ruteo y SLA automáticamente.",
    input_schema: {
      type: "object",
      properties: {
        firstName: { type: "string" },
        lastName: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        source: { type: "string" },
      },
      required: ["firstName"],
    },
    allowedRoles: ADVISOR_ROLES,
    handler: async (input) => {
      const { captureLead } = await import("@/lib/intake/capture-lead");
      return captureLead({
        source: (input.source as string) ?? "WHATSAPP",
        firstName: String(input.firstName),
        lastName: (input.lastName as string) ?? "(sin apellido)",
        phone: input.phone ? normalizePhoneE164(String(input.phone)) ?? undefined : undefined,
        email: input.email as string | undefined,
      });
    },
  },
];

export function toolsForAgent(allowedTools: string[], systemUser: User): AgentTool[] {
  return AGENT_TOOLS.filter(
    (t) => allowedTools.includes(t.name) && t.allowedRoles.includes(systemUser.role)
  );
}

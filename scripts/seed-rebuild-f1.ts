// Seeds canónicos del rebuild F1 — idempotente (upsert por nombre).
// CORRER DESPUÉS de aplicar prisma/migrations-manual/2026-06-10-f1-fundaciones.sql:
//   npx tsx scripts/seed-rebuild-f1.ts
//
// Crea: SlaPolicy default · RoutingRule round-robin · 8 AutomationRule canónicas (§D.5,
// INACTIVAS hasta que exista el runner de Fase 2) · 4 plantillas globales de marca.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const HOURS_LV = { start: "09:00", end: "18:00" };
const BUSINESS_HOURS = {
  PDC: { mon: HOURS_LV, tue: HOURS_LV, wed: HOURS_LV, thu: HOURS_LV, fri: HOURS_LV, sat: HOURS_LV },
  TULUM: { mon: HOURS_LV, tue: HOURS_LV, wed: HOURS_LV, thu: HOURS_LV, fri: HOURS_LV, sat: HOURS_LV },
  MERIDA: { mon: HOURS_LV, tue: HOURS_LV, wed: HOURS_LV, thu: HOURS_LV, fri: HOURS_LV, sat: HOURS_LV },
};

// Las 8 reglas canónicas del Anexo Técnico §D.5. isActive=false: el runner llega en Fase 2;
// mientras tanto son fixture + documentación viva del DSL.
const CANONICAL_RULES = [
  {
    name: "WF1 — Lead nuevo digital",
    description: "Lead digital entra → ruteo + SLA 5min + bot saluda y califica (L2) + notifica asesor",
    priority: 10,
    triggerType: "EVENT" as const,
    triggerConfig: { eventType: "lead.captured" },
    conditions: {
      all: [
        { field: "contact.leadSource", op: "in", value: ["FACEBOOK_ADS", "GOOGLE_ADS", "TIKTOK_ADS", "WEBSITE", "WHATSAPP", "INSTAGRAM"] },
      ],
    },
    actions: [
      { type: "ASSIGN", config: { strategy: "routing_rules" } },
      { type: "AI_REPLY", config: { channel: "WHATSAPP", goal: "saludo_calificacion" }, autonomyLevel: "L2" },
      { type: "NOTIFY", config: { to: "assignee", template: "lead_nuevo" } },
    ],
    cooldownMinutes: 60,
  },
  {
    name: "WF2 — Speed-to-lead dialer",
    description: "Lead asignado en horario laboral → click-to-call al asesor, luego marca al lead",
    priority: 20,
    triggerType: "EVENT" as const,
    triggerConfig: { eventType: "lead.assigned" },
    conditions: { all: [{ field: "context.isBusinessHours", op: "eq", value: true }] },
    actions: [{ type: "MAKE_CALL", config: { mode: "dialer_advisor_first" }, autonomyLevel: "L1" }],
    cooldownMinutes: 30,
  },
  {
    name: "WF3 — Anti-huérfano",
    description: "Contacto sin actividad 24-48h → re-rutea + alerta a coordinador (P2)",
    priority: 30,
    triggerType: "INACTIVITY" as const,
    triggerConfig: { hours: 24, field: "contact.lastActivityAt" },
    conditions: {
      all: [
        { field: "contact.contactType", op: "eq", value: "LEAD" },
        { field: "contact.doNotContact", op: "eq", value: false },
      ],
    },
    actions: [
      { type: "REASSIGN", config: { strategy: "routing_rules", reason: "orphan" } },
      { type: "ESCALATE", config: { to: "coordinator" } },
    ],
    cooldownMinutes: 1440,
  },
  {
    name: "WF4 — Post-visita sin cotización",
    description: "48h tras MEETING_COMPLETED sin Quote → tarea + draft IA de unidad sugerida (L0)",
    priority: 40,
    triggerType: "STAGE_CHANGE" as const,
    triggerConfig: { toStage: "MEETING_COMPLETED", delayMinutes: 2880 },
    conditions: { all: [{ field: "deal.hasQuote", op: "eq", value: false }] },
    actions: [
      { type: "CREATE_TASK", config: { subject: "Enviar cotización", dueInMinutes: 1440 } },
      { type: "AI_DRAFT", config: { kind: "quote_followup", useMatching: true }, autonomyLevel: "L0" },
    ],
    cooldownMinutes: 2880,
  },
  {
    name: "WF5 — Apartado a firma",
    description: "Deal RESERVED → checklist KYC + recordatorios D+2/D+5",
    priority: 50,
    triggerType: "STAGE_CHANGE" as const,
    triggerConfig: { toStage: "RESERVED" },
    conditions: {},
    actions: [
      { type: "CREATE_TASK", config: { subject: "Checklist KYC (expediente)", dueInMinutes: 1440 } },
      { type: "NOTIFY", config: { to: "assignee", template: "recordatorio_firma", delayMinutes: 2880 }, autonomyLevel: "L1" },
      { type: "NOTIFY", config: { to: "assignee", template: "recordatorio_firma", delayMinutes: 7200 }, autonomyLevel: "L1" },
    ],
  },
  {
    name: "WF6 — Pago vencido",
    description: "Parcialidad vencida → WhatsApp D+1, llamada D+7, escala a cobranza D+15",
    priority: 60,
    triggerType: "EVENT" as const,
    triggerConfig: { eventType: "payment.overdue" },
    conditions: {},
    actions: [
      { type: "SEND_WHATSAPP", config: { template: "pago_vencido", delayMinutes: 1440 }, autonomyLevel: "L1" },
      { type: "CREATE_TASK", config: { subject: "Llamada cobranza", delayMinutes: 10080 } },
      { type: "ESCALATE", config: { to: "cobranza", delayMinutes: 21600 } },
    ],
  },
  {
    name: "WF7 — Reactivación dormidos",
    description: "30d inactivo / WARM→COLD → secuencia IA con unidad que encaje (matching)",
    priority: 70,
    triggerType: "INACTIVITY" as const,
    triggerConfig: { hours: 720, field: "contact.lastActivityAt" },
    conditions: {
      all: [
        { field: "contact.temperature", op: "in", value: ["WARM", "COLD"] },
        { field: "contact.doNotContact", op: "eq", value: false },
        { field: "contact.whatsappOptOut", op: "eq", value: false },
      ],
    },
    actions: [{ type: "AI_DRAFT", config: { kind: "reactivacion", useMatching: true }, autonomyLevel: "L1" }],
    cooldownMinutes: 43200,
  },
  {
    name: "WF8 — Postventa entrega",
    description: "Deal ganado → bienvenida + encuesta + pedido de referidos",
    priority: 80,
    triggerType: "EVENT" as const,
    triggerConfig: { eventType: "deal.won" },
    conditions: {},
    actions: [
      { type: "SEND_WHATSAPP", config: { template: "bienvenida_postventa" }, autonomyLevel: "L1" },
      { type: "SEND_EMAIL", config: { template: "encuesta_satisfaccion", delayMinutes: 10080 }, autonomyLevel: "L1" },
      { type: "SEND_WHATSAPP", config: { template: "referidos", delayMinutes: 43200 }, autonomyLevel: "L1" },
    ],
  },
];

const GLOBAL_TEMPLATES = [
  {
    channel: "WHATSAPP" as const,
    name: "Primer contacto ES",
    shortcut: "/hola",
    language: "ES" as const,
    body:
      "Hola {{contact.firstName}}, soy {{user.name}} de Propyte. Gracias por tu interés" +
      " — ¿te gustaría que te comparta opciones según tu presupuesto y zona de interés?",
  },
  {
    channel: "WHATSAPP" as const,
    name: "First contact EN",
    shortcut: "/hello",
    language: "EN" as const,
    body:
      "Hi {{contact.firstName}}, this is {{user.name}} with Propyte. Thanks for reaching out" +
      " — would you like me to share options based on your budget and preferred area?",
  },
  {
    channel: "WHATSAPP" as const,
    name: "Seguimiento post-visita ES",
    shortcut: "/postvisita",
    language: "ES" as const,
    body:
      "{{contact.firstName}}, gracias por visitarnos. Te preparo la información de las unidades" +
      " que vimos y te la mando hoy mismo. ¿Hay algo específico que quieras revisar primero?",
  },
  {
    channel: "EMAIL" as const,
    name: "Presentación ES",
    shortcut: "/presentacion",
    language: "ES" as const,
    subject: "Opciones de inversión en la Riviera Maya — Propyte",
    body:
      "Hola {{contact.firstName}},\n\nSoy {{user.name}}, asesor en Propyte. Con gusto te acompaño" +
      " en tu búsqueda. Puedes agendar una llamada aquí: {{user.calendarUrl}}\n\nSaludos,\n{{user.name}}\n{{card.url}}",
  },
];

async function main() {
  // 1. Política SLA default (§D.2, businessHours por plaza — §K G.7)
  const sla = await prisma.slaPolicy.upsert({
    where: { name: "Default Propyte" },
    update: { businessHours: BUSINESS_HOURS },
    create: {
      name: "Default Propyte",
      isDefault: true,
      firstTouchMinutes: 5,
      retryMinutes: 30,
      orphanHours: 24,
      escalationChain: ["TEAM_LEADER", "GERENTE", "DIRECTOR"],
      businessHours: BUSINESS_HOURS,
      channelFallback: { afterRetry: "WHATSAPP" },
    },
  });
  console.log("SlaPolicy:", sla.name);

  // 2. Ruteo round-robin sobre asesores activos
  const routing = await prisma.routingRule.upsert({
    where: { name: "Round-robin asesores activos" },
    update: {},
    create: {
      name: "Round-robin asesores activos",
      priority: 100,
      isActive: true,
      conditions: {},
      strategy: "ROUND_ROBIN",
      targets: { roles: ["ASESOR", "ASESOR_SR", "ASESOR_JR"] },
    },
  });
  console.log("RoutingRule:", routing.name);

  // 3. Workflows canónicos (INACTIVOS hasta Fase 2)
  for (const rule of CANONICAL_RULES) {
    await prisma.automationRule.upsert({
      where: { name: rule.name },
      update: {
        description: rule.description,
        triggerType: rule.triggerType,
        triggerConfig: rule.triggerConfig,
        conditions: rule.conditions,
        actions: rule.actions,
        cooldownMinutes: rule.cooldownMinutes ?? null,
        priority: rule.priority,
      },
      create: { ...rule, isActive: false },
    });
    console.log("AutomationRule:", rule.name);
  }

  // 4. Plantillas globales de marca (userId=null)
  for (const t of GLOBAL_TEMPLATES) {
    const existing = await prisma.userTemplate.findFirst({
      where: { userId: null, name: t.name },
    });
    if (existing) {
      await prisma.userTemplate.update({ where: { id: existing.id }, data: t });
    } else {
      await prisma.userTemplate.create({ data: { ...t, userId: null } });
    }
    console.log("UserTemplate:", t.name);
  }

  console.log("\nSeeds F1 completos.");
}

main()
  .catch((e) => {
    console.error("Error en seeds:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

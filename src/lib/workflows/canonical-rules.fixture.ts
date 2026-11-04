// Copia de las 8 reglas canónicas de scripts/seed-rebuild-f1.ts, solo para tests.
// No se importa el seed porque ejecuta `main()` (y abre Prisma) al cargarse. Si cambia el seed,
// actualizar aquí: los tests de trigger-catalog/action-catalog verifican que se describan bien.
export const CANONICAL_RULES = [
  {
    name: "WF1", triggerType: "EVENT", triggerConfig: { eventType: "lead.captured" },
    conditions: { all: [{ field: "contact.leadSource", op: "in", value: ["FACEBOOK_ADS", "GOOGLE_ADS", "TIKTOK_ADS", "WEBSITE", "WHATSAPP", "INSTAGRAM"] }] },
    actions: [
      { type: "ASSIGN", config: { strategy: "routing_rules" } },
      { type: "AI_REPLY", config: { channel: "WHATSAPP", goal: "saludo_calificacion" }, autonomyLevel: "L2" },
      { type: "NOTIFY", config: { to: "assignee", template: "lead_nuevo" } },
    ],
  },
  {
    name: "WF2", triggerType: "EVENT", triggerConfig: { eventType: "lead.assigned" },
    conditions: { all: [{ field: "context.isBusinessHours", op: "eq", value: true }] },
    actions: [{ type: "MAKE_CALL", config: { mode: "dialer_advisor_first" }, autonomyLevel: "L1" }],
  },
  {
    name: "WF3", triggerType: "INACTIVITY", triggerConfig: { hours: 24, field: "contact.lastActivityAt" },
    conditions: { all: [{ field: "contact.contactType", op: "eq", value: "LEAD_COMPRADOR" }, { field: "contact.doNotContact", op: "eq", value: false }] },
    actions: [
      { type: "REASSIGN", config: { strategy: "routing_rules", reason: "orphan" } },
      { type: "ESCALATE", config: { to: "coordinator" } },
    ],
  },
  {
    name: "WF4", triggerType: "STAGE_CHANGE", triggerConfig: { toStage: "MEETING_COMPLETED", delayMinutes: 2880 },
    conditions: { all: [{ field: "deal.hasQuote", op: "eq", value: false }] },
    actions: [
      { type: "CREATE_TASK", config: { subject: "Enviar cotización", dueInMinutes: 1440 } },
      { type: "AI_DRAFT", config: { kind: "quote_followup", useMatching: true }, autonomyLevel: "L0" },
    ],
  },
  {
    name: "WF5", triggerType: "STAGE_CHANGE", triggerConfig: { toStage: "RESERVED" }, conditions: {},
    actions: [
      { type: "CREATE_TASK", config: { subject: "Checklist KYC (expediente)", dueInMinutes: 1440 } },
      { type: "NOTIFY", config: { to: "assignee", template: "recordatorio_firma", delayMinutes: 2880 }, autonomyLevel: "L1" },
      { type: "NOTIFY", config: { to: "assignee", template: "recordatorio_firma", delayMinutes: 7200 }, autonomyLevel: "L1" },
    ],
  },
  {
    name: "WF6", triggerType: "EVENT", triggerConfig: { eventType: "payment.overdue" }, conditions: {},
    actions: [
      { type: "SEND_WHATSAPP", config: { template: "pago_vencido", delayMinutes: 1440 }, autonomyLevel: "L1" },
      { type: "CREATE_TASK", config: { subject: "Llamada cobranza", delayMinutes: 10080 } },
      { type: "ESCALATE", config: { to: "cobranza", delayMinutes: 21600 } },
    ],
  },
  {
    name: "WF7", triggerType: "INACTIVITY", triggerConfig: { hours: 720, field: "contact.lastActivityAt" },
    conditions: { all: [
      { field: "contact.temperature", op: "in", value: ["WARM", "COLD"] },
      { field: "contact.doNotContact", op: "eq", value: false },
      { field: "contact.whatsappOptOut", op: "eq", value: false },
    ] },
    actions: [{ type: "AI_DRAFT", config: { kind: "reactivacion", useMatching: true }, autonomyLevel: "L1" }],
  },
  {
    name: "WF8", triggerType: "EVENT", triggerConfig: { eventType: "deal.won" }, conditions: {},
    actions: [
      { type: "SEND_WHATSAPP", config: { template: "bienvenida_postventa" }, autonomyLevel: "L1" },
      { type: "SEND_EMAIL", config: { template: "encuesta_satisfaccion", delayMinutes: 10080 }, autonomyLevel: "L1" },
      { type: "SEND_WHATSAPP", config: { template: "referidos", delayMinutes: 43200 }, autonomyLevel: "L1" },
    ],
  },
];

// src/lib/mcp/schema-introspection.ts
import { workflowActionTypes } from "@/lib/validations/rebuild-f1";

export function describeSchema() {
  return {
    triggerTypes: ["EVENT", "TIME", "BEHAVIORAL", "INACTIVITY", "STAGE_CHANGE", "SLA_BREACH", "SCORE_THRESHOLD"],
    eventTypesHint: ["lead.captured", "lead.assigned", "deal.stage_changed", "whatsapp.replied"],
    workflowActionTypes,
    leadAssignmentModes: ["ROUND_ROBIN", "PERFORMANCE", "MANUAL", "GUARDIA"],
    connectorProviders: [
      "META", "INSTAGRAM", "MESSENGER", "TIKTOK", "WEBSITE", "ZAPIER", "MANUAL",
      "GOOGLE", "LINKEDIN", "INMUEBLES24", "LAMUDI_PROPPIT", "PROPIEDADES",
      "VIVANUNCIOS", "EASYBROKER", "CUSTOM",
    ],
    roles: ["ADMIN", "ASESOR", "BROKER", "MANTENIMIENTO", "DIRECTOR", "GERENTE", "TEAM_LEADER", "ASESOR_SR", "ASESOR_JR", "HOSTESS", "MARKETING", "DEVELOPER_EXT"],
    plazas: ["PDC", "TULUM", "MERIDA"],
    conditionsDsl: {
      shape: "ConditionGroup recursivo",
      examples: [
        { all: [{ field: "source", op: "eq", value: "META" }, { field: "plaza", op: "eq", value: "TULUM" }] },
        { any: [{ field: "score", op: "gte", value: 70 }] },
      ],
      note: "Validado server-side por conditionsDslSchema (@/lib/validations/rebuild-f1).",
    },
    actionSpec: { shape: "{ type: WorkflowActionType, config: object }[]", min: 1 },
  };
}

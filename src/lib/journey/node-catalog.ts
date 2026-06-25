// Catálogo único de tipos de nodo (C.2-i3). Fuente de labels/categorías/campos
// para lienzo + paleta + inspector. Puro: sin React.
import { workflowActionTypes } from "@/lib/validations/rebuild-f1";
import { PIPELINE_STAGES, LIFECYCLE_ORDER, LIFECYCLE_LABELS } from "@/lib/constants";

export type NodeCategory = "Comunicación" | "Pipeline" | "Asignación" | "IA" | "Otros";
export type FieldKind = "text" | "number" | "textarea" | "select" | "checkbox";

export interface FieldDef {
  configKey: string;
  label: string;
  kind: FieldKind;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface NodeTypeMeta {
  type: string;
  category: NodeCategory;
  label: string;
  summaryKey?: string;
  fields?: FieldDef[];
}

const STAGE_OPTS = PIPELINE_STAGES.map((s) => ({ value: s.code, label: s.label }));
const LIFECYCLE_OPTS = LIFECYCLE_ORDER.map((s) => ({ value: s, label: LIFECYCLE_LABELS[s] ?? s }));
const UPDATE_FIELD_OPTS = ["temperature", "contactStatus", "urgency", "contactType", "leadSource"]
  .map((f) => ({ value: f, label: f }));

export const NODE_CATALOG: NodeTypeMeta[] = [
  { type: "SEND_WHATSAPP", category: "Comunicación", label: "💬 WhatsApp", summaryKey: "template",
    fields: [
      { configKey: "template", label: "Plantilla", kind: "text", placeholder: "bienvenida_es" },
      { configKey: "body", label: "Mensaje (si no hay plantilla)", kind: "textarea" },
    ] },
  { type: "SEND_EMAIL", category: "Comunicación", label: "✉️ Email", summaryKey: "template",
    fields: [
      { configKey: "template", label: "Plantilla", kind: "text" },
      { configKey: "subject", label: "Asunto", kind: "text" },
      { configKey: "body", label: "Cuerpo", kind: "textarea" },
    ] },
  { type: "MAKE_CALL", category: "Comunicación", label: "📞 Llamada" },
  { type: "NOTIFY", category: "Comunicación", label: "🔔 Notificar", summaryKey: "title",
    fields: [
      { configKey: "title", label: "Título", kind: "text" },
      { configKey: "message", label: "Mensaje", kind: "textarea" },
      { configKey: "type", label: "Tipo", kind: "text", placeholder: "workflow" },
    ] },
  { type: "CHANGE_STAGE", category: "Pipeline", label: "🎯 Cambiar etapa", summaryKey: "toStage",
    fields: [{ configKey: "toStage", label: "Etapa del pipeline", kind: "select", options: STAGE_OPTS }] },
  { type: "SET_LIFECYCLE", category: "Pipeline", label: "♻️ Ciclo de vida", summaryKey: "toStage",
    fields: [
      { configKey: "toStage", label: "Etapa de ciclo de vida", kind: "select", options: LIFECYCLE_OPTS },
      { configKey: "allowBackward", label: "Permitir retroceso", kind: "checkbox" },
    ] },
  { type: "ADD_TAG", category: "Pipeline", label: "🏷️ Tag", summaryKey: "tag",
    fields: [{ configKey: "tag", label: "Etiqueta", kind: "text" }] },
  { type: "UPDATE_FIELD", category: "Pipeline", label: "✎ Campo",
    fields: [
      { configKey: "field", label: "Campo", kind: "select", options: UPDATE_FIELD_OPTS },
      { configKey: "value", label: "Valor", kind: "text" },
    ] },
  { type: "ASSIGN", category: "Asignación", label: "👤 Asignar",
    fields: [{ configKey: "reason", label: "Motivo", kind: "text" }] },
  { type: "REASSIGN", category: "Asignación", label: "👤 Reasignar",
    fields: [{ configKey: "reason", label: "Motivo", kind: "text" }] },
  { type: "ESCALATE", category: "Asignación", label: "⚠️ Escalar",
    fields: [{ configKey: "reason", label: "Motivo", kind: "text" }] },
  { type: "AI_DRAFT", category: "IA", label: "🤖 Borrador IA" },
  { type: "AI_REPLY", category: "IA", label: "🤖 Respuesta IA" },
  { type: "AI_CALL_SUMMARY", category: "IA", label: "🤖 Resumen llamada" },
  { type: "CREATE_TASK", category: "Otros", label: "📋 Tarea", summaryKey: "subject",
    fields: [
      { configKey: "subject", label: "Asunto", kind: "text" },
      { configKey: "description", label: "Descripción", kind: "textarea" },
      { configKey: "dueInMinutes", label: "Vence en (min)", kind: "number", placeholder: "1440" },
    ] },
  { type: "ENROLL_PLAN", category: "Otros", label: "⟳ Cadencia" },
  { type: "WEBHOOK", category: "Otros", label: "🔗 Webhook" },
];

// Verify at module load: NODE_CATALOG must cover exactly workflowActionTypes
// (TypeScript can't enforce count at compile time, so we do a runtime assertion in non-prod)
if (process.env.NODE_ENV !== "production") {
  const catalogTypes = new Set(NODE_CATALOG.map((m) => m.type));
  for (const t of workflowActionTypes) {
    if (!catalogTypes.has(t)) {
      console.warn(`[node-catalog] Missing entry for workflowActionType: ${t}`);
    }
  }
}

const BY_TYPE = new Map(NODE_CATALOG.map((m) => [m.type, m]));
const CATEGORY_ORDER: NodeCategory[] = ["Comunicación", "Pipeline", "Asignación", "IA", "Otros"];

export function metaFor(type: string): NodeTypeMeta | undefined {
  return BY_TYPE.get(type);
}
export function labelFor(type: string): string {
  return BY_TYPE.get(type)?.label ?? type;
}
export function fieldDefsFor(type: string): FieldDef[] {
  return BY_TYPE.get(type)?.fields ?? [];
}
export function summaryFor(type: string, config: Record<string, unknown>): string {
  const m = BY_TYPE.get(type);
  const label = m?.label ?? type;
  const k = m?.summaryKey;
  const v = k ? config?.[k] : undefined;
  return v !== undefined && v !== null && String(v) !== "" ? `${label} · ${String(v)}` : label;
}
export function paletteGroups(): { category: NodeCategory; items: NodeTypeMeta[] }[] {
  return CATEGORY_ORDER
    .map((category) => ({ category, items: NODE_CATALOG.filter((m) => m.category === category) }))
    .filter((g) => g.items.length > 0);
}

export const TRIGGER_FIELDS: Record<string, FieldDef[]> = {
  EVENT: [{ configKey: "eventType", label: "Evento", kind: "text", placeholder: "lead.captured" }],
  STAGE_CHANGE: [{ configKey: "toStage", label: "Cambia a etapa", kind: "select", options: STAGE_OPTS }],
};
export function triggerFieldsFor(triggerType: string): FieldDef[] {
  return TRIGGER_FIELDS[triggerType] ?? [];
}

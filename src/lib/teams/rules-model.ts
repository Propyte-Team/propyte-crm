// Lógica pura de la pantalla de reglas de asignación (Configuración → Equipos & Territorios).
// Sin React ni BD, para poder probarla sola. Los resúmenes legibles se muestran en la lista
// de reglas; el editor usa el árbol de condiciones del builder de workflows.
import type { RoutingStrategy, RoutingTargets } from "@/lib/validations/routing-rule";

// Campos del contacto que tiene sentido usar para repartir un lead. El evaluador resuelve
// dot-paths sobre { contact, adAttribution }, así que cualquier otro campo también vale;
// estos son los que se sugieren en el editor.
export const ROUTING_FIELD_SUGGESTIONS = [
  "contact.leadSource",
  "contact.contactType",
  "contact.targetPlaza",
  "contact.preferredZone",
  "contact.preferredLanguage",
  "contact.budgetMin",
  "contact.budgetMax",
  "contact.propertyType",
  "contact.temperature",
  "contact.score",
  "contact.residenceCountry",
  "adAttribution.campaignName",
  "adAttribution.adsetName",
  "adAttribution.network",
] as const;

export const STRATEGY_LABELS: Record<RoutingStrategy, string> = {
  ROUND_ROBIN: "Turno (round-robin)",
  PERFORMANCE: "Menor carga",
  GUARDIA: "Guardia (primero disponible)",
  MANUAL: "Manual (primero de la lista)",
};

export const FIELD_LABELS: Record<string, string> = {
  "contact.leadSource": "fuente",
  "contact.contactType": "tipo de contacto",
  "contact.targetPlaza": "plaza",
  "contact.preferredZone": "zona preferida",
  "contact.preferredLanguage": "idioma",
  "contact.budgetMin": "presupuesto mín.",
  "contact.budgetMax": "presupuesto máx.",
  "contact.propertyType": "tipo de propiedad",
  "contact.temperature": "temperatura",
  "contact.score": "score",
  "contact.residenceCountry": "país de residencia",
  "adAttribution.campaignName": "campaña",
  "adAttribution.adsetName": "conjunto de anuncios",
  "adAttribution.network": "red",
};

const OP_LABELS: Record<string, string> = {
  eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤",
  in: "en", nin: "no en", contains: "contiene", exists: "existe", changed_to: "cambió a",
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/^contact\./, "");
}

function valueLabel(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value == null) return "";
  return String(value);
}

/** Resumen legible del DSL de condiciones. Sin condiciones → "siempre". */
export function describeConditions(conditions: unknown): string {
  if (!conditions || typeof conditions !== "object") return "siempre";
  const node = conditions as Record<string, unknown>;
  if (Array.isArray(node.all)) {
    const parts = node.all.map(describeConditions).filter((p) => p !== "siempre");
    return parts.length ? parts.join(" y ") : "siempre";
  }
  if (Array.isArray(node.any)) {
    const parts = node.any.map(describeConditions).filter((p) => p !== "siempre");
    return parts.length ? `(${parts.join(" o ")})` : "siempre";
  }
  if (typeof node.field === "string" && typeof node.op === "string") {
    if (node.op === "exists") return `${fieldLabel(node.field)} existe`;
    return `${fieldLabel(node.field)} ${OP_LABELS[node.op] ?? node.op} ${valueLabel(node.value)}`.trim();
  }
  return "siempre";
}

/** Resumen legible del destino de una regla de ruteo. */
export function describeTargets(
  targets: RoutingTargets | null | undefined,
  usersById: Record<string, string> = {},
): string {
  const t = targets ?? {};
  if (t.userIds && t.userIds.length > 0) {
    return "Usuarios: " + t.userIds.map((id) => usersById[id] ?? id.slice(0, 8)).join(", ");
  }
  const roles = t.roles && t.roles.length > 0 ? t.roles.join(", ") : "asesores";
  return t.plaza ? `${roles} de ${t.plaza}` : `${roles} de la plaza del lead`;
}

/** Estado del formulario de destino → `targets` que guarda la API (sin claves vacías). */
export function buildTargets(form: { mode: "roles" | "users"; roles: string[]; userIds: string[]; plaza: string }): RoutingTargets {
  if (form.mode === "users") {
    return form.userIds.length > 0 ? { userIds: form.userIds } : {};
  }
  const out: RoutingTargets = {};
  if (form.roles.length > 0) out.roles = form.roles as RoutingTargets["roles"];
  if (form.plaza) out.plaza = form.plaza as RoutingTargets["plaza"];
  return out;
}

/** `targets` guardados → estado del formulario. */
export function parseTargets(targets: unknown): { mode: "roles" | "users"; roles: string[]; userIds: string[]; plaza: string } {
  const t = (targets && typeof targets === "object" ? targets : {}) as RoutingTargets;
  if (Array.isArray(t.userIds) && t.userIds.length > 0) {
    return { mode: "users", roles: [], userIds: t.userIds, plaza: "" };
  }
  return { mode: "roles", roles: Array.isArray(t.roles) ? t.roles : [], userIds: [], plaza: t.plaza ?? "" };
}

/** Prioridad sugerida para una regla nueva: después de la última (deja hueco de 10). */
export function nextPriority(existing: Array<{ priority: number }>): number {
  if (existing.length === 0) return 100;
  return Math.min(1000, Math.max(...existing.map((r) => r.priority)) + 10);
}

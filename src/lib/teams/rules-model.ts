// Lógica pura de la pantalla de reglas de asignación (Configuración → Equipos & Territorios).
// Sin React ni BD, para poder probarla sola. Los resúmenes legibles se muestran en la lista
// de reglas; el editor usa el árbol de condiciones del builder de workflows.
import type { RoutingTargets } from "@/lib/validations/routing-rule";
import {
  ROUTING_STRATEGY_LABELS, ROLE_LABELS_COMPLETO, PLAZA_LABELS, etiqueta,
} from "@/lib/labels";
import { buildConditionsTree, type ConditionTree } from "@/lib/workflows/builder-model";
import {
  FIELD_LABELS, FIELD_VALUE_LABELS, describeConditions, validarCondiciones,
} from "@/lib/workflows/condition-catalog";

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

// Etiquetas de estrategia: las de labels.ts, salvo "Turno", sin jerga en inglés.
export const STRATEGY_LABELS: Record<string, string> = {
  ...ROUTING_STRATEGY_LABELS,
  ROUND_ROBIN: "Turno",
};

// Estrategias que se ofrecen al crear/editar. Guardia y Manual siguen aceptándose en la API
// pero ya no se ofrecen en la pantalla.
export const OFFERED_STRATEGIES = ["ROUND_ROBIN", "PERFORMANCE"] as const;

/** Opciones del selector de estrategia; si la regla ya tiene una retirada, se conserva para poder verla y cambiarla. */
export function strategyOptions(current?: string): { value: string; label: string }[] {
  const values: string[] = [...OFFERED_STRATEGIES];
  if (current && !values.includes(current)) values.push(current);
  return values.map((value) => ({ value, label: etiqueta(STRATEGY_LABELS, value) }));
}

// Etiquetas de campo/valor y descripción de condiciones: viven en el catálogo de condiciones
// (E2) para que reglas de reparto, cadencias y flujos se lean igual. Se reexportan aquí para
// no tocar a los consumidores.
export { FIELD_LABELS, FIELD_VALUE_LABELS, describeConditions };

/** Resumen legible del destino de una regla de ruteo. */
export function describeTargets(
  targets: RoutingTargets | null | undefined,
  usersById: Record<string, string> = {},
  teamsById: Record<string, string> = {},
): string {
  const t = targets ?? {};
  if (t.teamId) return "Equipo " + (teamsById[t.teamId] ?? t.teamId.slice(0, 8));
  if (t.userIds && t.userIds.length > 0) {
    return "Usuarios: " + t.userIds.map((id) => usersById[id] ?? id.slice(0, 8)).join(", ");
  }
  const roles = t.roles && t.roles.length > 0 ? t.roles.map((r) => etiqueta(ROLE_LABELS_COMPLETO, r)).join(", ") : "asesores";
  return t.plaza ? `${roles} de ${etiqueta(PLAZA_LABELS, t.plaza)}` : `${roles} de la plaza del lead`;
}

/** Estado del formulario de destino → `targets` que guarda la API (sin claves vacías). */
export function buildTargets(form: { mode: "roles" | "users" | "team"; roles: string[]; userIds: string[]; plaza: string; teamId?: string }): RoutingTargets {
  if (form.mode === "team") {
    return form.teamId ? { teamId: form.teamId } : {};
  }
  if (form.mode === "users") {
    return form.userIds.length > 0 ? { userIds: form.userIds } : {};
  }
  const out: RoutingTargets = {};
  if (form.roles.length > 0) out.roles = form.roles as RoutingTargets["roles"];
  if (form.plaza) out.plaza = form.plaza as RoutingTargets["plaza"];
  return out;
}

/** `targets` guardados → estado del formulario. */
export function parseTargets(targets: unknown): { mode: "roles" | "users" | "team"; roles: string[]; userIds: string[]; plaza: string; teamId: string } {
  const t = (targets && typeof targets === "object" ? targets : {}) as RoutingTargets;
  if (typeof t.teamId === "string" && t.teamId) {
    return { mode: "team", roles: [], userIds: [], plaza: "", teamId: t.teamId };
  }
  if (Array.isArray(t.userIds) && t.userIds.length > 0) {
    return { mode: "users", roles: [], userIds: t.userIds, plaza: "", teamId: "" };
  }
  return { mode: "roles", roles: Array.isArray(t.roles) ? t.roles : [], userIds: [], plaza: t.plaza ?? "", teamId: "" };
}

/** Prioridad sugerida para una regla nueva: después de la última (deja hueco de 10). */
export function nextPriority(existing: Array<{ priority: number }>): number {
  if (existing.length === 0) return 100;
  return Math.min(1000, Math.max(...existing.map((r) => r.priority)) + 10);
}

/**
 * ¿Hay alguna condición a medias? Fila sin campo, sin operador, con un operador que exige
 * valor y el valor vacío, o con un valor que no corresponde al tipo del campo. Sirve para avisar
 * antes de guardar (el constructor descartaría la fila en silencio).
 */
export function hasIncompleteCondition(tree: ConditionTree): boolean {
  const hojas = tree.items.flatMap((item) => ("conditions" in item ? item.conditions : [item]));
  // buildConditionsTree descarta en silencio las filas sin campo/operador: si el DSL trae
  // menos hojas que el árbol, había filas a medias que validarCondiciones ya no vería.
  if (hojas.some((c) => !c.field.trim() || !c.op)) return true;
  return !validarCondiciones(buildConditionsTree(tree)).ok;
}

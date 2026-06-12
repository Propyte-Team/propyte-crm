// Evaluador del DSL de condiciones (Anexo Técnico §D.4) — función PURA, sin BD.
// El RuleEngine (Fase 2) la usa contra un contexto { contact, deal, event, context }.
import type { ConditionNode } from "@/lib/validations/rebuild-f1";

type Ctx = Record<string, unknown>;

// Resuelve "contact.score" → ctx.contact.score (dot-path, null-safe)
function resolve(ctx: Ctx, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc != null && typeof acc === "object") return (acc as Ctx)[key];
    return undefined;
  }, ctx);
}

function compare(op: string, actual: unknown, expected: unknown, ctx: Ctx, field: string): boolean {
  switch (op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "nin":
      return Array.isArray(expected) && !expected.includes(actual);
    case "contains":
      if (Array.isArray(actual)) return actual.includes(expected);
      if (typeof actual === "string" && typeof expected === "string") return actual.includes(expected);
      return false;
    case "exists":
      return actual !== undefined && actual !== null;
    case "changed_to": {
      // El valor actual debe ser `expected` Y el evento debe traer un previous distinto.
      // Convención: event.payload.previous<Campo> (ej. previousStage para deal.stage).
      if (actual !== expected) return false;
      const leaf = field.split(".").pop() ?? "";
      const prevKey = "previous" + leaf.charAt(0).toUpperCase() + leaf.slice(1);
      const prev = resolve(ctx, `event.payload.${prevKey}`);
      return prev === undefined || prev !== expected;
    }
    default:
      return false;
  }
}

export function evaluateConditions(node: ConditionNode | Record<string, never> | null | undefined, ctx: Ctx): boolean {
  if (node == null) return true;
  if (typeof node !== "object") return false;

  if ("all" in node && Array.isArray(node.all)) {
    return node.all.every((child) => evaluateConditions(child, ctx));
  }
  if ("any" in node && Array.isArray(node.any)) {
    return node.any.some((child) => evaluateConditions(child, ctx));
  }
  if ("field" in node && "op" in node) {
    const { field, op, value } = node as { field: string; op: string; value?: unknown };
    return compare(op, resolve(ctx, field), value, ctx, field);
  }
  // Objeto vacío = sin condiciones = true
  return Object.keys(node).length === 0;
}

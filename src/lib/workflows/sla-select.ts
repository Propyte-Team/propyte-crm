// src/lib/workflows/sla-select.ts
// Selección de política SLA por segmento. PURA (recibe políticas ya cargadas).
import { evaluateConditions } from "./evaluate-conditions";
import type { ConditionNode } from "@/lib/validations/rebuild-f1";

export interface SlaPolicyLike {
  id: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  priority: number;
  conditions: unknown;
}

export function selectSlaPolicy<T extends SlaPolicyLike>(policies: T[], ctx: Record<string, unknown>): T | null {
  const candidates = policies
    .filter((p) => p.isActive && !p.isDefault)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  for (const p of candidates) {
    if (evaluateConditions(p.conditions as ConditionNode | Record<string, never>, ctx)) return p;
  }
  return policies.find((p) => p.isActive && p.isDefault) ?? null;
}

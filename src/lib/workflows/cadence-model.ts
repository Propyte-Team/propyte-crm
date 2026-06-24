// Lógica pura del editor de cadencias (sub-B): zod del plan/pasos + normalización de orden.
import { z } from "zod";
import { workflowActionTypes, conditionsDslSchema } from "@/lib/validations/rebuild-f1";

export const stepInputSchema = z.object({
  actionType: z.enum(workflowActionTypes),
  delayMinutes: z.number().int().min(0).max(1_000_000),
  config: z.record(z.unknown()).default({}),
  autonomyLevel: z.enum(["L0", "L1", "L2"]).default("L0"),
});
export type StepInput = z.infer<typeof stepInputSchema>;

export const planInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  exitConditions: conditionsDslSchema.optional(),
  steps: z.array(stepInputSchema).default([]),
});
export type PlanInput = z.infer<typeof planInputSchema>;

/** Reasigna `order` 0..n-1 según la posición en el arreglo (la UI define el orden). */
export function normalizeStepsOrder(steps: StepInput[]): Array<StepInput & { order: number }> {
  return steps.map((s, i) => ({ ...s, order: i }));
}

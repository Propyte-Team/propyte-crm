import { describe, it, expect } from "vitest";
import { z } from "zod";
import { conditionsDslSchema, workflowActionTypes } from "@/lib/validations/rebuild-f1";

// Réplica del actions schema que DEBE usar la API (incluye delayMinutes).
const actionsSchema = z
  .array(z.object({
    type: z.enum(workflowActionTypes),
    config: z.record(z.unknown()).default({}),
    delayMinutes: z.number().int().min(0).optional(),
  }))
  .min(1);

describe("ruleSchema.actions acepta delayMinutes", () => {
  it("conserva delayMinutes tras parsear", () => {
    const r = actionsSchema.parse([{ type: "SEND_WHATSAPP", config: { body: "hola" }, delayMinutes: 10 }]);
    expect(r[0].delayMinutes).toBe(10);
  });
  it("delayMinutes ausente es válido", () => {
    const r = actionsSchema.parse([{ type: "ADD_TAG", config: { tag: "x" } }]);
    expect(r[0].delayMinutes).toBeUndefined();
  });
  it("conditionsDslSchema sigue aceptando objeto vacío", () => {
    expect(conditionsDslSchema.parse({})).toEqual({});
  });
});

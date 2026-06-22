import { describe, it, expect } from "vitest";
import { z } from "zod";
import { RULE_TEMPLATES } from "./builder-templates";
import { conditionsDslSchema, workflowActionTypes } from "@/lib/validations/rebuild-f1";

const TRIGGER_TYPES = ["EVENT", "TIME", "BEHAVIORAL", "INACTIVITY", "STAGE_CHANGE", "SLA_BREACH", "SCORE_THRESHOLD"] as const;
const ruleSchema = z.object({
  name: z.string().min(3).max(120),
  description: z.string().max(500).optional().nullable(),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerConfig: z.record(z.unknown()).default({}),
  conditions: conditionsDslSchema,
  actions: z.array(z.object({
    type: z.enum(workflowActionTypes),
    config: z.record(z.unknown()).default({}),
    delayMinutes: z.number().int().min(0).optional(),
  })).min(1),
});

describe("RULE_TEMPLATES", () => {
  it("hay 3 plantillas con keys Lead/Broker/Empleo", () => {
    expect(RULE_TEMPLATES.map((t) => t.key).sort()).toEqual(["broker", "empleo", "lead"]);
  });
  it("cada plantilla produce una regla válida contra ruleSchema", () => {
    for (const t of RULE_TEMPLATES) {
      const parsed = ruleSchema.safeParse(t.rule);
      expect(parsed.success, `${t.key}: ${JSON.stringify((parsed as any).error?.flatten?.())}`).toBe(true);
    }
  });
});

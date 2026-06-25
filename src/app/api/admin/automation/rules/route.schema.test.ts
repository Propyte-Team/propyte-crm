import { describe, it, expect } from "vitest";
import { workflowActionsSchema } from "@/lib/validations/rebuild-f1";

describe("ruleSchema.actions (árbol)", () => {
  it("acepta árbol con decisión vía workflowActionsSchema", () => {
    const r = workflowActionsSchema.min(1).safeParse([
      { kind: "decision", branches: [{ conditions: {}, steps: [{ type: "ASSIGN", config: {} }] }] },
    ]);
    expect(r.success).toBe(true);
  });
  it("rechaza lista vacía", () => {
    expect(workflowActionsSchema.min(1).safeParse([]).success).toBe(false);
  });
});

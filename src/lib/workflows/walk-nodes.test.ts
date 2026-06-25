import { describe, it, expect } from "vitest";
import { walkNodes } from "./walk-nodes";
import type { WorkflowNode } from "@/lib/validations/rebuild-f1";

const ctx = {
  contact: { contactType: "COMPRADOR", score: 80 },
  adAttribution: { network: "meta" },
};

describe("walkNodes", () => {
  it("lista plana → todas las acciones, paths secuenciales", () => {
    const tree: WorkflowNode[] = [
      { type: "ADD_TAG", config: { tag: "a" } },
      { type: "ASSIGN", config: {}, delayMinutes: 5 },
    ];
    const out = walkNodes(tree, ctx);
    expect(out.map((s) => [s.actionType, s.path])).toEqual([
      ["ADD_TAG", "0"],
      ["ASSIGN", "1"],
    ]);
    expect(out[1].delayMinutes).toBe(5);
  });

  it("decisión: toma la primera rama que cumple", () => {
    const tree: WorkflowNode[] = [
      {
        kind: "decision",
        branches: [
          { conditions: { field: "adAttribution.network", op: "eq", value: "web" }, steps: [{ type: "NOTIFY", config: {} }] },
          { conditions: { field: "adAttribution.network", op: "eq", value: "meta" }, steps: [{ type: "ASSIGN", config: {} }] },
        ],
      },
    ];
    const out = walkNodes(tree, ctx);
    expect(out.map((s) => [s.actionType, s.path])).toEqual([["ASSIGN", "0.b1.0"]]);
  });

  it("decisión: cae en else si ninguna rama cumple", () => {
    const tree: WorkflowNode[] = [
      {
        kind: "decision",
        branches: [{ conditions: { field: "adAttribution.network", op: "eq", value: "web" }, steps: [{ type: "NOTIFY", config: {} }] }],
        else: [{ type: "ADD_TAG", config: { tag: "otro" } }],
      },
    ];
    const out = walkNodes(tree, ctx);
    expect(out.map((s) => [s.actionType, s.path])).toEqual([["ADD_TAG", "0.else.0"]]);
  });

  it("decisión sin rama que cumple y sin else → nada", () => {
    const tree: WorkflowNode[] = [
      { kind: "decision", branches: [{ conditions: { field: "adAttribution.network", op: "eq", value: "web" }, steps: [{ type: "NOTIFY", config: {} }] }] },
    ];
    expect(walkNodes(tree, ctx)).toEqual([]);
  });

  it("rama con conditions vacías = siempre cumple (default)", () => {
    const tree: WorkflowNode[] = [
      { kind: "decision", branches: [{ conditions: {}, steps: [{ type: "NOTIFY", config: {} }] }] },
    ];
    expect(walkNodes(tree, ctx).map((s) => s.actionType)).toEqual(["NOTIFY"]);
  });

  it("anidado: decisión dentro de rama, path compuesto", () => {
    const tree: WorkflowNode[] = [
      {
        kind: "decision",
        branches: [
          {
            conditions: { field: "contact.contactType", op: "eq", value: "COMPRADOR" },
            steps: [
              { type: "ADD_TAG", config: { tag: "comprador" } },
              {
                kind: "decision",
                branches: [{ conditions: { field: "contact.score", op: "gte", value: 70 }, steps: [{ type: "ESCALATE", config: {} }] }],
              },
            ],
          },
        ],
      },
    ];
    const out = walkNodes(tree, ctx);
    expect(out.map((s) => [s.actionType, s.path])).toEqual([
      ["ADD_TAG", "0.b0.0"],
      ["ESCALATE", "0.b0.1.b0.0"],
    ]);
  });

  it("propaga autonomyLevel a la EnqueueSpec", () => {
    const tree: WorkflowNode[] = [{ type: "AI_DRAFT", config: {}, autonomyLevel: "L2" }];
    expect(walkNodes(tree, ctx)[0].autonomyLevel).toBe("L2");
  });
});

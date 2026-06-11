import { describe, it, expect } from "vitest";
import { evaluateConditions } from "./evaluate-conditions";

const ctx = {
  contact: { score: 80, preferredLanguage: "EN", tags: ["vip"], doNotContact: false, urgency: null },
  deal: { stage: "PROPOSAL_SENT", value: 3500000 },
  event: { type: "quote.opened", payload: { previousStage: "NEGOTIATION" } },
};

describe("evaluateConditions (DSL §D.4)", () => {
  it("objeto vacío = siempre true", () => {
    expect(evaluateConditions({}, ctx)).toBe(true);
  });
  it("eq / neq", () => {
    expect(evaluateConditions({ field: "deal.stage", op: "eq", value: "PROPOSAL_SENT" }, ctx)).toBe(true);
    expect(evaluateConditions({ field: "deal.stage", op: "neq", value: "WON" }, ctx)).toBe(true);
  });
  it("comparadores numéricos", () => {
    expect(evaluateConditions({ field: "contact.score", op: "gte", value: 70 }, ctx)).toBe(true);
    expect(evaluateConditions({ field: "contact.score", op: "lt", value: 70 }, ctx)).toBe(false);
  });
  it("in / nin", () => {
    expect(evaluateConditions({ field: "deal.stage", op: "in", value: ["PROPOSAL_SENT", "NEGOTIATION"] }, ctx)).toBe(true);
    expect(evaluateConditions({ field: "deal.stage", op: "nin", value: ["WON", "LOST"] }, ctx)).toBe(true);
  });
  it("contains sobre arrays y strings", () => {
    expect(evaluateConditions({ field: "contact.tags", op: "contains", value: "vip" }, ctx)).toBe(true);
    expect(evaluateConditions({ field: "event.type", op: "contains", value: "quote" }, ctx)).toBe(true);
  });
  it("exists", () => {
    expect(evaluateConditions({ field: "contact.urgency", op: "exists" }, ctx)).toBe(false);
    expect(evaluateConditions({ field: "contact.score", op: "exists" }, ctx)).toBe(true);
    expect(evaluateConditions({ field: "contact.noExiste", op: "exists" }, ctx)).toBe(false);
  });
  it("changed_to compara contra event.payload.previousStage implícito", () => {
    expect(evaluateConditions({ field: "deal.stage", op: "changed_to", value: "PROPOSAL_SENT" }, ctx)).toBe(true);
    expect(evaluateConditions({ field: "deal.stage", op: "changed_to", value: "WON" }, ctx)).toBe(false);
  });
  it("all anidado", () => {
    expect(
      evaluateConditions(
        {
          all: [
            { field: "contact.score", op: "gte", value: 70 },
            { any: [{ field: "deal.stage", op: "eq", value: "WON" }, { field: "event.type", op: "eq", value: "quote.opened" }] },
          ],
        },
        ctx
      )
    ).toBe(true);
  });
  it("all corta en false", () => {
    expect(
      evaluateConditions(
        { all: [{ field: "contact.score", op: "gte", value: 99 }, { field: "deal.stage", op: "eq", value: "PROPOSAL_SENT" }] },
        ctx
      )
    ).toBe(false);
  });
  it("campo inexistente nunca matchea (excepto exists/nin)", () => {
    expect(evaluateConditions({ field: "contact.fantasma", op: "eq", value: 1 }, ctx)).toBe(false);
    expect(evaluateConditions({ field: "contact.fantasma", op: "nin", value: [1] }, ctx)).toBe(true);
  });
});

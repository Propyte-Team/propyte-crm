import { describe, it, expect } from "vitest";
import { buildTriggerConfig, parseValue, buildConditions, nodeToRows, parseTriggerValue } from "./builder-model";

describe("parseValue", () => {
  it("exists → true", () => expect(parseValue("exists", "")).toBe(true));
  it("in → array recortado", () => expect(parseValue("in", "a, b ,c")).toEqual(["a", "b", "c"]));
  it("numérico → number", () => expect(parseValue("eq", "70")).toBe(70));
  it("texto → string", () => expect(parseValue("contains", "BROKER")).toBe("BROKER"));
});

describe("buildConditions (plano)", () => {
  it("vacío → {}", () => expect(buildConditions("all", [])).toEqual({}));
  it("filtra incompletas y serializa", () => {
    expect(buildConditions("any", [
      { field: "contact.score", op: "gte", value: "70" },
      { field: "", op: "eq", value: "x" },
    ])).toEqual({ any: [{ field: "contact.score", op: "gte", value: 70 }] });
  });
});

describe("nodeToRows", () => {
  it("reconstruye filas desde DSL", () => {
    expect(nodeToRows({ all: [{ field: "deal.stage", op: "eq", value: "WON" }] }))
      .toEqual({ combinator: "all", rows: [{ field: "deal.stage", op: "eq", value: "WON" }] });
  });
});

describe("buildTriggerConfig / parseTriggerValue", () => {
  it("EVENT round-trip", () => {
    const cfg = buildTriggerConfig("EVENT", "lead.captured");
    expect(cfg).toEqual({ eventType: "lead.captured" });
    expect(parseTriggerValue({ triggerConfig: cfg })).toBe("lead.captured");
  });
});

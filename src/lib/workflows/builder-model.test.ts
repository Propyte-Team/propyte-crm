import { describe, it, expect } from "vitest";
import { buildTriggerConfig, parseValue, buildConditions, nodeToRows, parseTriggerValue, FIELD_SUGGESTIONS } from "./builder-model";

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

import { matchesTrigger } from "./engine";

describe("STAGE_CHANGE usa toStage (bug fix)", () => {
  it("buildTriggerConfig escribe toStage", () => {
    expect(buildTriggerConfig("STAGE_CHANGE", "RESERVED")).toEqual({ toStage: "RESERVED" });
  });

  it("parseTriggerValue lee toStage y compat con 'stage' viejo", () => {
    expect(parseTriggerValue({ triggerConfig: { toStage: "WON" } })).toBe("WON");
    expect(parseTriggerValue({ triggerConfig: { stage: "LOST" } })).toBe("LOST"); // regla vieja
  });

  it("round-trip: regla del builder matchea evento deal.stage_changed", () => {
    const cfg = buildTriggerConfig("STAGE_CHANGE", "RESERVED");
    const rule = { triggerType: "STAGE_CHANGE" as const, triggerConfig: cfg };
    const event = { type: "deal.stage_changed", payload: { toStage: "RESERVED" } };
    expect(matchesTrigger(rule, event as any)).toBe(true);
    const other = { type: "deal.stage_changed", payload: { toStage: "WON" } };
    expect(matchesTrigger(rule, other as any)).toBe(false);
  });
});

describe("FIELD_SUGGESTIONS incluye campos de segmentación", () => {
  it("tiene contactType y adAttribution.*", () => {
    for (const f of ["contact.contactType", "adAttribution.campaignName", "adAttribution.adName", "adAttribution.adsetName", "adAttribution.network", "contact.custom."]) {
      expect(FIELD_SUGGESTIONS).toContain(f);
    }
  });
});

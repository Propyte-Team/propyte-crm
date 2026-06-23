import { describe, it, expect } from "vitest";
import { matchesTrigger } from "./engine";

describe("matchesTrigger LIFECYCLE_CHANGE", () => {
  it("matchea cuando toStage coincide", () => {
    const rule = { triggerType: "LIFECYCLE_CHANGE" as const, triggerConfig: { toStage: "MQL" } };
    expect(matchesTrigger(rule, { type: "contact.lifecycle_changed", payload: { toStage: "MQL" } })).toBe(true);
    expect(matchesTrigger(rule, { type: "contact.lifecycle_changed", payload: { toStage: "SQL" } })).toBe(false);
  });
  it("matchea cualquier toStage si no se especifica en la regla", () => {
    const rule = { triggerType: "LIFECYCLE_CHANGE" as const, triggerConfig: {} };
    expect(matchesTrigger(rule, { type: "contact.lifecycle_changed", payload: { toStage: "MQL" } })).toBe(true);
  });
});

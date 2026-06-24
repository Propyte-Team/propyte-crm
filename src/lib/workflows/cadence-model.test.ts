import { describe, it, expect } from "vitest";
import { planInputSchema, normalizeStepsOrder } from "./cadence-model";

describe("cadence-model", () => {
  it("planInputSchema acepta un plan válido con pasos", () => {
    const r = planInputSchema.safeParse({
      name: "Bienvenida", description: "x", exitConditions: {},
      steps: [{ actionType: "SEND_WHATSAPP", delayMinutes: 0, config: {}, autonomyLevel: "L0" }],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza actionType inválido", () => {
    const r = planInputSchema.safeParse({
      name: "X", steps: [{ actionType: "NOPE", delayMinutes: 0, config: {}, autonomyLevel: "L0" }],
    });
    expect(r.success).toBe(false);
  });

  it("rechaza delayMinutes negativo", () => {
    const r = planInputSchema.safeParse({
      name: "X", steps: [{ actionType: "SEND_WHATSAPP", delayMinutes: -1, config: {}, autonomyLevel: "L0" }],
    });
    expect(r.success).toBe(false);
  });

  it("normalizeStepsOrder reasigna order 0..n preservando secuencia", () => {
    const out = normalizeStepsOrder([
      { actionType: "A", delayMinutes: 0, config: {}, autonomyLevel: "L0" },
      { actionType: "B", delayMinutes: 5, config: {}, autonomyLevel: "L1" },
    ] as never);
    expect(out.map((s) => s.order)).toEqual([0, 1]);
    expect(out[1].actionType).toBe("B");
  });
});

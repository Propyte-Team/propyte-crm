import { describe, it, expect } from "vitest";
import { slaPolicyInputSchema } from "./sla-model";

const ok = { name: "Broker MX", firstTouchMinutes: 15, retryMinutes: 60, orphanHours: 48 };

describe("slaPolicyInputSchema", () => {
  it("acepta mínimo válido con defaults", () => {
    const r = slaPolicyInputSchema.parse(ok);
    expect(r.priority).toBe(100);
    expect(r.conditions).toEqual({});
    expect(r.businessHours).toEqual({});
    expect(r.isActive).toBe(true);
  });
  it("acepta businessHours válido", () => {
    const r = slaPolicyInputSchema.parse({ ...ok, businessHours: { tz: "America/Cancun", days: { "1": [540, 1080], "0": null } } });
    expect((r.businessHours as { days: unknown }).days).toBeDefined();
  });
  it("rechaza apertura >= cierre", () => {
    expect(slaPolicyInputSchema.safeParse({ ...ok, businessHours: { tz: "America/Cancun", days: { "1": [1080, 540] } } }).success).toBe(false);
  });
  it("rechaza conditions con forma inválida", () => {
    expect(slaPolicyInputSchema.safeParse({ ...ok, conditions: { bogus: 1 } }).success).toBe(false);
  });
  it("rechaza minutos fuera de rango", () => {
    expect(slaPolicyInputSchema.safeParse({ ...ok, firstTouchMinutes: 0 }).success).toBe(false);
  });
  it("rechaza timezone inválida", () => {
    expect(slaPolicyInputSchema.safeParse({ ...ok, businessHours: { tz: "No/Existe", days: { "1": [540, 1080] } } }).success).toBe(false);
  });
  it("acepta America/Cancun", () => {
    expect(slaPolicyInputSchema.safeParse({ ...ok, businessHours: { tz: "America/Cancun", days: { "1": [540, 1080] } } }).success).toBe(true);
  });
});

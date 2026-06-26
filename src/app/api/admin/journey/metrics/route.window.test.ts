import { describe, it, expect } from "vitest";
import { cutoffFromWindow, parseMetricsQuery } from "./route-helpers";

describe("parseMetricsQuery", () => {
  it("válido", () => {
    const r = parseMetricsQuery(new URLSearchParams("ruleId=abc&window=90"));
    expect(r).toEqual({ ok: true, ruleId: "abc", window: "90" });
  });
  it("falta ruleId → no ok (400)", () => {
    expect(parseMetricsQuery(new URLSearchParams("window=30")).ok).toBe(false);
  });
  it("window inválido → no ok (400)", () => {
    expect(parseMetricsQuery(new URLSearchParams("ruleId=abc&window=zzz")).ok).toBe(false);
  });
  it("window ausente → default 30", () => {
    const r = parseMetricsQuery(new URLSearchParams("ruleId=abc"));
    expect(r).toMatchObject({ ok: true, window: "30" });
  });
});

describe("cutoffFromWindow", () => {
  it("'all' → null", () => {
    expect(cutoffFromWindow("all", 1_000_000)).toBeNull();
  });
  it("'30' → now - 30 días", () => {
    const now = 1_000_000_000_000;
    expect(cutoffFromWindow("30", now)?.getTime()).toBe(now - 30 * 86_400_000);
  });
  it("'7' y '90' calculan el offset correcto", () => {
    const now = 2_000_000_000_000;
    expect(cutoffFromWindow("7", now)?.getTime()).toBe(now - 7 * 86_400_000);
    expect(cutoffFromWindow("90", now)?.getTime()).toBe(now - 90 * 86_400_000);
  });
});

import { describe, it, expect } from "vitest";
import { cutoffFromWindow } from "./route";

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

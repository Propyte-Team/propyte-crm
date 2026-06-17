import { describe, it, expect } from "vitest";
import { monthRange, computeGoalProgress } from "./progress";

describe("monthRange", () => {
  it("start = period, end = +1 mes", () => {
    const { start, end } = monthRange(new Date(Date.UTC(2026, 5, 1)));
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
  it("cruza el año dic→ene", () => {
    const { end } = monthRange(new Date(Date.UTC(2026, 11, 1)));
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("computeGoalProgress", () => {
  it("met cuando actual >= target", () => {
    expect(computeGoalProgress(10, 10)).toEqual({ pct: 100, status: "met" });
    expect(computeGoalProgress(10, 12).status).toBe("met");
  });
  it("on_track cuando pct >= 70 y < 100", () => {
    expect(computeGoalProgress(10, 7)).toEqual({ pct: 70, status: "on_track" });
  });
  it("behind cuando pct < 70", () => {
    expect(computeGoalProgress(10, 4)).toEqual({ pct: 40, status: "behind" });
  });
  it("target <= 0 → pct 0 sin dividir por cero", () => {
    expect(computeGoalProgress(0, 5)).toEqual({ pct: 0, status: "behind" });
  });
});

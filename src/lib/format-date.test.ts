import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime } from "./format-date";

describe("formatDate (tz fija America/Cancun)", () => {
  it("usa el día de Cancún (UTC-5), no UTC, cerca de medianoche", () => {
    // 2026-07-09T02:00:00Z = 2026-07-08 21:00 en Cancún → día 8, no 9.
    expect(formatDate("2026-07-09T02:00:00Z", { day: "2-digit", month: "2-digit", year: "numeric" })).toBe("08/07/2026");
  });
  it("es determinista (no depende de la tz del runtime)", () => {
    const iso = "2026-07-09T15:00:00Z";
    expect(formatDate(iso, { day: "2-digit", month: "2-digit", year: "numeric" })).toBe("09/07/2026");
  });
});

describe("formatDateTime (tz fija America/Cancun)", () => {
  it("formatea fecha+hora en tz Cancún", () => {
    // 2026-07-09T20:00:00Z = 15:00 Cancún → contiene el día 9 y la hora 15/3.
    const out = formatDateTime("2026-07-09T20:00:00Z");
    expect(out).toContain("9/7/2026");
  });
});

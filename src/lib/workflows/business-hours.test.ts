import { describe, it, expect } from "vitest";
import { computeDueAt, type BusinessHours } from "./business-hours";

// Horario 09:00–18:00 (540–1080) lun–vie; sáb/dom cerrados. tz Cancún (UTC-5, sin DST).
const BH: BusinessHours = {
  tz: "America/Cancun",
  days: { "0": null, "1": [540, 1080], "2": [540, 1080], "3": [540, 1080], "4": [540, 1080], "5": [540, 1080], "6": null },
};
const wall = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cancun", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
const at = (iso: string) => new Date(`${iso}:00-05:00`);

describe("computeDueAt", () => {
  it("wall-clock cuando businessHours vacío", () => {
    const start = new Date("2026-07-09T20:00:00Z");
    expect(computeDueAt(start, 30, {}).getTime()).toBe(start.getTime() + 30 * 60000);
    expect(computeDueAt(start, 30, null).getTime()).toBe(start.getTime() + 30 * 60000);
  });
  it("dentro de la ventana suma directo", () => {
    expect(wall(computeDueAt(at("2026-07-09T15:00"), 30, BH))).toBe("2026-07-09, 15:30");
  });
  it("antes de apertura cuenta desde la apertura", () => {
    expect(wall(computeDueAt(at("2026-07-09T07:00"), 30, BH))).toBe("2026-07-09, 09:30");
  });
  it("después del cierre pasa a la siguiente apertura", () => {
    expect(wall(computeDueAt(at("2026-07-09T19:00"), 30, BH))).toBe("2026-07-10, 09:30");
  });
  it("cruza el día acumulando el resto", () => {
    expect(wall(computeDueAt(at("2026-07-09T17:50"), 30, BH))).toBe("2026-07-10, 09:20");
  });
  it("salta fin de semana", () => {
    expect(wall(computeDueAt(at("2026-07-11T10:00"), 30, BH))).toBe("2026-07-13, 09:30");
  });
  it("minutes=0 devuelve el inicio", () => {
    const start = at("2026-07-09T15:00");
    expect(computeDueAt(start, 0, BH).getTime()).toBe(start.getTime());
  });
  it("semana entera cerrada cae a wall-clock", () => {
    const allClosed: BusinessHours = { tz: "America/Cancun", days: { "0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": null } };
    const start = at("2026-07-09T15:00");
    expect(computeDueAt(start, 30, allClosed).getTime()).toBe(start.getTime() + 30 * 60000);
  });
  it("minutos negativos = wall-clock en ambos paths", () => {
    const start = at("2026-07-09T15:00");
    expect(computeDueAt(start, -30, {}).getTime()).toBe(start.getTime() - 30 * 60000);
    expect(computeDueAt(start, -30, BH).getTime()).toBe(start.getTime() - 30 * 60000);
  });
  it("acumulación multi-día dentro del cap (240 min = 4h → 2do día)", () => {
    // jueves 16:00, quedan 2h hoy (hasta 18:00) + 2h viernes desde 09:00 → 11:00
    expect(wall(computeDueAt(at("2026-07-09T16:00"), 240, BH))).toBe("2026-07-10, 11:00");
  });
  it("timezone inválida cae a wall-clock sin lanzar", () => {
    const start = new Date("2026-07-09T20:00:00Z");
    const bad = { tz: "No/Existe", days: { "4": [540, 1080] } } as BusinessHours;
    expect(() => computeDueAt(start, 30, bad)).not.toThrow();
    expect(computeDueAt(start, 30, bad).getTime()).toBe(start.getTime() + 30 * 60000);
  });
});

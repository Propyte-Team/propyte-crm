import { describe, it, expect } from "vitest";
import { FECHA_INVALIDA_REPORTE, rangoDeFechas } from "./rango-fechas";

// #893: los filtros de fecha de los reportes se convertían con `new Date("YYYY-MM-DD")`
// (medianoche UTC = 19:00 del día anterior en Cancún) y el «hasta» iba con `lte`: el último día
// del rango quedaba fuera casi entero.

describe("rangoDeFechas", () => {
  it("sin fechas no filtra", () => {
    expect(rangoDeFechas()).toBeUndefined();
    expect(rangoDeFechas("", "")).toBeUndefined();
    expect(rangoDeFechas(null, undefined)).toBeUndefined();
  });

  it("«desde» es medianoche de Cancún (05:00 UTC), no medianoche UTC", () => {
    expect(rangoDeFechas("2026-10-01")).toEqual({ gte: new Date("2026-10-01T05:00:00.000Z") });
  });

  it("«hasta» incluye el día completo: corta ANTES de la medianoche de Cancún del día siguiente", () => {
    const r = rangoDeFechas(undefined, "2026-10-15")!;
    expect(r.lt).toEqual(new Date("2026-10-16T05:00:00.000Z"));
    expect(r.gte).toBeUndefined();
  });

  it("una venta a las 22:00 del último día (hora de Cancún) cae dentro; antes quedaba fuera", () => {
    const r = rangoDeFechas("2026-10-01", "2026-10-15")!;
    const venta = new Date("2026-10-15T22:00:00-05:00");
    expect(venta >= r.gte! && venta < r.lt!).toBe(true);
    // El cálculo anterior: `lte: new Date("2026-10-15")`.
    expect(venta <= new Date("2026-10-15")).toBe(false);
  });

  it("y una de las 20:00 del día ANTERIOR al «desde» queda fuera; antes entraba", () => {
    const r = rangoDeFechas("2026-10-01", "2026-10-15")!;
    const venta = new Date("2026-09-30T20:00:00-05:00");
    expect(venta >= r.gte!).toBe(false);
    expect(venta >= new Date("2026-10-01")).toBe(true);
  });

  it("cruza fin de mes y de año", () => {
    expect(rangoDeFechas(undefined, "2026-12-31")!.lt).toEqual(new Date("2027-01-01T05:00:00.000Z"));
    expect(rangoDeFechas(undefined, "2028-02-28")!.lt).toEqual(new Date("2028-02-29T05:00:00.000Z"));
  });

  it.each(["2026-02-30", "15/10/2026", "2026-10-15T10:00", "mañana"])("rechaza %s en vez de adivinar", (v) => {
    expect(() => rangoDeFechas(v)).toThrow(FECHA_INVALIDA_REPORTE);
    expect(() => rangoDeFechas(undefined, v)).toThrow(FECHA_INVALIDA_REPORTE);
  });
});

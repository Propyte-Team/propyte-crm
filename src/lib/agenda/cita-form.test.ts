import { describe, it, expect } from "vitest";
import { aDatetimeLocalCancun } from "./cita-form";
import { parseDueDate } from "@/lib/due-date";

describe("aDatetimeLocalCancun", () => {
  it("convierte un instante UTC a la hora de pared de Cancún (UTC−5)", () => {
    expect(aDatetimeLocalCancun("2026-10-20T15:00:00.000Z")).toBe("2026-10-20T10:00");
  });

  it("cruza la medianoche hacia el día anterior", () => {
    expect(aDatetimeLocalCancun("2026-10-20T03:30:00.000Z")).toBe("2026-10-19T22:30");
  });

  it("usa formato de 24 horas, sin '24:00' a medianoche", () => {
    expect(aDatetimeLocalCancun("2026-10-20T05:00:00.000Z")).toBe("2026-10-20T00:00");
  });

  it("devuelve cadena vacía sin fecha o con una fecha inválida", () => {
    expect(aDatetimeLocalCancun(null)).toBe("");
    expect(aDatetimeLocalCancun(undefined)).toBe("");
    expect(aDatetimeLocalCancun("")).toBe("");
    expect(aDatetimeLocalCancun("no-es-fecha")).toBe("");
  });

  it("es la inversa de parseDueDate: guardar sin tocar la fecha no la mueve", () => {
    const instante = new Date("2026-10-20T15:00:00.000Z");
    const campo = aDatetimeLocalCancun(instante.toISOString());
    expect(parseDueDate(campo)?.toISOString()).toBe(instante.toISOString());
  });
});

import { describe, it, expect } from "vitest";
import { cancunDayRange, cancunDayKey } from "./grouping";

// Tarjeta #715, bug A-04. /agenda agrupaba en hora de Cancún y /hoy calculaba su rango
// con setHours() sobre la zona del proceso —UTC en el contenedor—, así que entre las
// 19:00 y la medianoche de Cancún las dos pantallas discrepaban de qué día es hoy.

describe("cancunDayRange", () => {
  it("cubre el día civil de Cancún, de medianoche a medianoche", () => {
    const { start, end } = cancunDayRange(new Date("2026-09-07T18:00:00.000Z"));

    // 2026-09-07 00:00 en Cancún = 05:00 UTC del mismo día.
    expect(start.toISOString()).toBe("2026-09-07T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-08T04:59:59.999Z");
  });

  it("a las 23:30 UTC todavía es el día anterior en Cancún", () => {
    // El caso que rompía: 23:30 UTC del 7 son las 18:30 del 7 en Cancún, así que el día
    // NO ha cambiado, aunque en UTC falte media hora para hacerlo.
    const { start, end } = cancunDayRange(new Date("2026-09-07T23:30:00.000Z"));

    expect(start.toISOString()).toBe("2026-09-07T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-08T04:59:59.999Z");
  });

  it("a las 03:00 UTC ya es día nuevo en UTC pero no en Cancún", () => {
    const { start } = cancunDayRange(new Date("2026-09-08T03:00:00.000Z"));

    expect(start.toISOString()).toBe("2026-09-07T05:00:00.000Z");
  });

  it("a las 05:00 UTC arranca el día nuevo en Cancún", () => {
    const { start } = cancunDayRange(new Date("2026-09-08T05:00:00.000Z"));

    expect(start.toISOString()).toBe("2026-09-08T05:00:00.000Z");
  });

  it("coincide con el día que usa la agrupación de la agenda", () => {
    // Las dos pantallas tienen que estar de acuerdo: es el punto del arreglo.
    for (const instante of [
      "2026-09-07T05:00:00.000Z",
      "2026-09-07T18:00:00.000Z",
      "2026-09-07T23:59:59.000Z",
      "2026-09-08T04:59:00.000Z",
    ]) {
      const ahora = new Date(instante);
      const { start } = cancunDayRange(ahora);
      expect(cancunDayKey(start)).toBe(cancunDayKey(ahora));
    }
  });

  it("Cancún no tiene horario de verano: en julio el offset es el mismo que en enero", () => {
    // Quintana Roo está fuera del horario de verano desde 2015 y México lo suprimió en
    // 2022. Si eso cambiara, esta prueba avisa antes que un usuario.
    const enero = cancunDayRange(new Date("2026-01-15T18:00:00.000Z"));
    const julio = cancunDayRange(new Date("2026-07-15T18:00:00.000Z"));

    expect(enero.start.toISOString().slice(11)).toBe("05:00:00.000Z");
    expect(julio.start.toISOString().slice(11)).toBe("05:00:00.000Z");
  });
});

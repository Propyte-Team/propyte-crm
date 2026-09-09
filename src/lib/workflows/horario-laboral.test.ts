import { describe, it, expect } from "vitest";

// Tarjeta #680. Había DOS definiciones de horario laboral que no se hablaban: la
// configurable de SlaPolicy.businessHours, que decide los plazos de los relojes de
// atención, y una escrita a mano en engine.ts:77-83 que alimentaba `context.isBusinessHours`
// del DSL de reglas. La segunda fijaba 09-18 en América/Cancún, contaba el sábado como
// laborable e ignoraba la política, así que una regla podía disparar un sábado a las cinco
// mientras el reloj —con una política que cierra sábados— consideraba la oficina cerrada.
//
// La prueba (c) que pedía la tarjeta es la del sábado: con days["6"] = null, un sábado a
// las 17:00 de Cancún tiene que dar false. Con el código anterior daba true.

import {
  estaEnHorarioLaboral,
  HORARIO_POR_DEFECTO,
  computeDueAt,
  type BusinessHours,
} from "./business-hours";

/** Un instante en hora de Cancún (UTC-5, sin horario de verano desde 2015). */
function cancun(iso: string): Date {
  return new Date(`${iso}-05:00`);
}

// 2026-09-05 es sábado; 2026-09-06 domingo; 2026-09-07 lunes.
const SABADO_17H = cancun("2026-09-05T17:00:00");
const DOMINGO_12H = cancun("2026-09-06T12:00:00");
const LUNES_10H = cancun("2026-09-07T10:00:00");
const LUNES_08H = cancun("2026-09-07T08:00:00");
const LUNES_18H = cancun("2026-09-07T18:00:00");

/** Agenda que cierra el sábado, que es lo que una SlaPolicy puede configurar. */
const SIN_SABADOS: BusinessHours = {
  tz: "America/Cancun",
  days: {
    "0": null,
    "1": [9 * 60, 18 * 60],
    "2": [9 * 60, 18 * 60],
    "3": [9 * 60, 18 * 60],
    "4": [9 * 60, 18 * 60],
    "5": [9 * 60, 18 * 60],
    "6": null,
  },
};

describe("estaEnHorarioLaboral — el caso sábado (#680)", () => {
  it("con una agenda que cierra sábados, el sábado a las 17:00 NO es horario laboral", () => {
    // Este es el negativo de la tarjeta. La definición vieja de engine.ts devolvía true
    // aquí, porque su única exclusión era `day !== 0`.
    expect(estaEnHorarioLaboral(SABADO_17H, SIN_SABADOS)).toBe(false);
  });

  it("y con la agenda de reserva sí lo es, porque es lo que hacía el código anterior", () => {
    // El fallback no cambia el comportamiento: reproduce el sábado abierto a propósito.
    expect(estaEnHorarioLaboral(SABADO_17H, HORARIO_POR_DEFECTO)).toBe(true);
  });
});

describe("estaEnHorarioLaboral — los límites del día (#680)", () => {
  it("las 09:00 entran y las 18:00 ya no", () => {
    // Cerrado en el minuto de cierre: mismo criterio que computeDueAt, que usa `mod < close`.
    expect(estaEnHorarioLaboral(LUNES_10H, SIN_SABADOS)).toBe(true);
    expect(estaEnHorarioLaboral(cancun("2026-09-07T09:00:00"), SIN_SABADOS)).toBe(true);
    expect(estaEnHorarioLaboral(LUNES_18H, SIN_SABADOS)).toBe(false);
    expect(estaEnHorarioLaboral(cancun("2026-09-07T17:59:00"), SIN_SABADOS)).toBe(true);
  });

  it("antes de abrir no es horario laboral", () => {
    expect(estaEnHorarioLaboral(LUNES_08H, SIN_SABADOS)).toBe(false);
  });

  it("el domingo está cerrado en las dos agendas", () => {
    expect(estaEnHorarioLaboral(DOMINGO_12H, SIN_SABADOS)).toBe(false);
    expect(estaEnHorarioLaboral(DOMINGO_12H, HORARIO_POR_DEFECTO)).toBe(false);
  });
});

describe("estaEnHorarioLaboral — sin agenda devuelve null, no false (#680)", () => {
  it("null, undefined y una agenda sin ningún día abierto no se pueden responder", () => {
    // `null` significa «no se puede saber» y quien llama decide. Devolver `false` a ciegas
    // haría que una regla condicionada a horario de oficina no dispare NUNCA, y eso es peor
    // que el bug porque no deja rastro.
    expect(estaEnHorarioLaboral(LUNES_10H, null)).toBeNull();
    expect(estaEnHorarioLaboral(LUNES_10H, undefined)).toBeNull();
    expect(estaEnHorarioLaboral(LUNES_10H, {})).toBeNull();
    expect(estaEnHorarioLaboral(LUNES_10H, { tz: "America/Cancun" })).toBeNull();
    expect(
      estaEnHorarioLaboral(LUNES_10H, { tz: "America/Cancun", days: { "0": null, "6": null } })
    ).toBeNull();
  });

  it("una zona horaria inválida tampoco se puede responder", () => {
    expect(estaEnHorarioLaboral(LUNES_10H, { tz: "No/Existe", days: { "1": [540, 1080] } })).toBeNull();
  });

  it("una agenda sin tz no cuenta como agenda, aunque tenga días", () => {
    // computeDueAt exige tz por la misma razón: sin zona, los minutos del día no significan
    // nada. Los dos tienen que estar de acuerdo en qué es una agenda válida.
    expect(estaEnHorarioLaboral(LUNES_10H, { days: { "1": [540, 1080] } })).toBeNull();
  });
});

describe("las dos funciones comparten la misma noción de agenda (#680)", () => {
  it("lo que computeDueAt trata como wall-clock es lo que estaEnHorarioLaboral no sabe responder", () => {
    // Es la propiedad que justifica esta tarjeta: una sola definición. Si divergen, vuelve
    // a haber dos calendarios.
    const agendasSinValidez: (BusinessHours | null)[] = [
      null,
      {},
      { tz: "America/Cancun" },
      { days: { "1": [540, 1080] } },
      { tz: "America/Cancun", days: { "0": null } },
    ];

    for (const agenda of agendasSinValidez) {
      const inicio = LUNES_10H;
      // wall-clock: 30 minutos naturales, sin saltar a la siguiente ventana.
      expect(computeDueAt(inicio, 30, agenda).getTime()).toBe(inicio.getTime() + 30 * 60000);
      expect(estaEnHorarioLaboral(inicio, agenda)).toBeNull();
    }
  });

  it("y con una agenda válida las dos la respetan: sábado cerrado", () => {
    // El vencimiento de 30 minutos hábiles arrancado un sábado cae el LUNES a las 09:30,
    // y esa misma agenda dice que el sábado no es laborable. Antes, la del DSL decía que sí.
    expect(estaEnHorarioLaboral(SABADO_17H, SIN_SABADOS)).toBe(false);
    expect(computeDueAt(SABADO_17H, 30, SIN_SABADOS).toISOString()).toBe(
      cancun("2026-09-07T09:30:00").toISOString()
    );
  });
});

import { describe, it, expect } from "vitest";
import {
  CONFIG_POR_DEFECTO,
  VENTANA_MINUTOS,
  estadoDelPlazo,
  formatoPlazo,
  horarioDeLaRegla,
  leerConfigReasignacion,
  siguienteConfig,
  venceReasignacion,
} from "./sla-reasignacion-model";
import { HORARIO_POR_DEFECTO } from "./business-hours";

describe("leerConfigReasignacion", () => {
  it("sin fila o con basura: apagada con los valores por defecto", () => {
    expect(leerConfigReasignacion(null)).toEqual(CONFIG_POR_DEFECTO);
    expect(leerConfigReasignacion("sí")).toEqual(CONFIG_POR_DEFECTO);
    expect(leerConfigReasignacion([true])).toEqual(CONFIG_POR_DEFECTO);
    expect(CONFIG_POR_DEFECTO).toMatchObject({ activo: false, minutosHabiles: 60, maxReasignaciones: 2 });
  });

  it("solo `true` la enciende; un string no", () => {
    expect(leerConfigReasignacion({ activo: "true" }).activo).toBe(false);
    expect(leerConfigReasignacion({ activo: true }).activo).toBe(true);
  });

  it("recorta los números fuera de rango y redondea", () => {
    const c = leerConfigReasignacion({ activo: true, minutosHabiles: 5, maxReasignaciones: 99.4 });
    expect(c.minutosHabiles).toBe(15);
    expect(c.maxReasignaciones).toBe(5);
    expect(leerConfigReasignacion({ minutosHabiles: 90.6 }).minutosHabiles).toBe(91);
  });

  it("descarta una fecha de encendido inválida", () => {
    expect(leerConfigReasignacion({ activo: true, activoDesde: "ayer" }).activoDesde).toBeNull();
    expect(leerConfigReasignacion({ activo: true, activoDesde: "2026-11-04T15:00:00.000Z" }).activoDesde).toBe(
      "2026-11-04T15:00:00.000Z",
    );
  });
});

describe("siguienteConfig", () => {
  const ahora = new Date("2026-11-04T16:00:00.000Z");
  const entrada = { activo: true, minutosHabiles: 60, maxReasignaciones: 2 };

  it("sella `activoDesde` al encender", () => {
    expect(siguienteConfig(CONFIG_POR_DEFECTO, entrada, ahora).activoDesde).toBe(ahora.toISOString());
  });

  it("lo conserva si ya estaba encendida y solo cambia el plazo", () => {
    const antes = { ...entrada, activoDesde: "2026-11-01T15:00:00.000Z" };
    const nueva = siguienteConfig(antes, { ...entrada, minutosHabiles: 90 }, ahora);
    expect(nueva.activoDesde).toBe("2026-11-01T15:00:00.000Z");
    expect(nueva.minutosHabiles).toBe(90);
  });

  it("lo borra al apagar", () => {
    const antes = { ...entrada, activoDesde: "2026-11-01T15:00:00.000Z" };
    expect(siguienteConfig(antes, { ...entrada, activo: false }, ahora).activoDesde).toBeNull();
  });
});

describe("plazo de la reasignación", () => {
  it("sin horario en la política usa el horario laboral por defecto", () => {
    expect(horarioDeLaRegla(null)).toBe(HORARIO_POR_DEFECTO);
    expect(horarioDeLaRegla({})).toBe(HORARIO_POR_DEFECTO);
  });

  it("un lead asignado de noche vence una hora después de abrir, no a medianoche", () => {
    // Lunes 2-nov-2026 20:00 en Cancún (UTC-5) = 3-nov 01:00 UTC. Abre el martes a las 09:00.
    const vence = venceReasignacion(new Date("2026-11-03T01:00:00.000Z"), 60, null);
    expect(vence.toISOString()).toBe("2026-11-03T15:00:00.000Z");
  });

  it("dentro del horario son 60 minutos de reloj", () => {
    // Martes 3-nov 11:00 Cancún = 16:00 UTC.
    const vence = venceReasignacion(new Date("2026-11-03T16:00:00.000Z"), 60, null);
    expect(vence.toISOString()).toBe("2026-11-03T17:00:00.000Z");
  });

  it("en plazo, vencido y fuera de la ventana de reintento", () => {
    const vence = new Date("2026-11-03T17:00:00.000Z");
    expect(estadoDelPlazo(vence, new Date("2026-11-03T16:59:00.000Z"))).toBe("en_plazo");
    expect(estadoDelPlazo(vence, vence)).toBe("vencido");
    expect(estadoDelPlazo(vence, new Date(vence.getTime() + VENTANA_MINUTOS * 60_000))).toBe("vencido");
    expect(estadoDelPlazo(vence, new Date(vence.getTime() + VENTANA_MINUTOS * 60_000 + 1))).toBe("fuera_de_ventana");
  });
});

describe("formatoPlazo", () => {
  it("horas y minutos legibles", () => {
    expect(formatoPlazo(45)).toBe("45 min");
    expect(formatoPlazo(60)).toBe("1 h");
    expect(formatoPlazo(90)).toBe("1 h 30 min");
  });
});

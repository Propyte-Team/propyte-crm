import { describe, expect, it } from "vitest";
import {
  MAX_STEPS_AGOTADOS,
  RESPUESTA_TRUNCADA,
  esCorridaSinTerminar,
  resumenDeCorrida,
} from "./run-status";

describe("esCorridaSinTerminar", () => {
  it("reconoce las dos formas de quedarse a medias", () => {
    expect(esCorridaSinTerminar(`${MAX_STEPS_AGOTADOS}: se acabaron los 8 pasos.`)).toBe(true);
    expect(esCorridaSinTerminar(`${RESPUESTA_TRUNCADA}: tope de tokens.`)).toBe(true);
  });

  it("un error de verdad NO es quedarse a medias", () => {
    expect(esCorridaSinTerminar("Claude API 529: overloaded")).toBe(false);
    expect(esCorridaSinTerminar(null)).toBe(false);
    expect(esCorridaSinTerminar(undefined)).toBe(false);
  });

  // La marca es un PREFIJO: si alguien la mete a media frase, no cuenta. Asi un mensaje de
  // error que casualmente mencione el tope no se disfraza de corrida agotada.
  it("solo cuenta como prefijo, no en cualquier parte del mensaje", () => {
    expect(esCorridaSinTerminar(`fallo raro que menciona ${MAX_STEPS_AGOTADOS}`)).toBe(false);
  });
});

describe("resumenDeCorrida", () => {
  it("suma tokens y tiempos de todos los pasos", () => {
    expect(
      resumenDeCorrida([
        { step: 0, tokens_entrada: 100, tokens_salida: 20, ms_modelo: 800, ms_tool: 50 },
        { step: 1, tokens_entrada: 340, tokens_salida: 15, ms_modelo: 600 },
      ]),
    ).toEqual({ tokens_entrada: 440, tokens_salida: 35, ms_modelo: 1400, ms_tool: 50, pasos: 2 });
  });

  /**
   * Las corridas escritas antes de instrumentar el runner no tienen medición. Sumar 0 es
   * honesto —no se midieron— y sobre todo no revienta: un `NaN` aquí se propagaría a
   * cualquier reporte que use el total y lo volveria ilegible sin decir por qué.
   */
  it("los pasos viejos sin medición suman 0 en vez de NaN", () => {
    const r = resumenDeCorrida([{ step: 0, thought: "hola" }, { step: 1, tool: "buscar" }]);
    expect(r).toEqual({ tokens_entrada: 0, tokens_salida: 0, ms_modelo: 0, ms_tool: 0, pasos: 2 });
  });

  it("aguanta lo que no es una lista de pasos", () => {
    const vacio = { tokens_entrada: 0, tokens_salida: 0, ms_modelo: 0, ms_tool: 0, pasos: 0 };
    expect(resumenDeCorrida(null)).toEqual(vacio);
    expect(resumenDeCorrida("[]")).toEqual(vacio);
    expect(resumenDeCorrida([])).toEqual(vacio);
  });

  it("ignora valores no numéricos en vez de arrastrarlos", () => {
    expect(resumenDeCorrida([{ tokens_entrada: "muchos", ms_modelo: NaN }]).tokens_entrada).toBe(0);
    expect(resumenDeCorrida([{ tokens_entrada: "muchos", ms_modelo: NaN }]).ms_modelo).toBe(0);
  });
});

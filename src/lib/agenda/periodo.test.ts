import { describe, it, expect } from "vitest";
import { matchPeriodo } from "./periodo";

// Jueves 8 de octubre de 2026, 12:00 en Cancún (UTC−5).
const NOW = new Date("2026-10-08T17:00:00.000Z");

// Mediodía de Cancún de un día dado, en ISO: evita que el offset cambie el día civil.
const dia = (ymd: string) => `${ymd}T17:00:00.000Z`;

describe("matchPeriodo", () => {
  it("todas incluye también las tareas sin fecha", () => {
    expect(matchPeriodo(null, "todas", NOW)).toBe(true);
    expect(matchPeriodo(dia("2026-01-01"), "todas", NOW)).toBe(true);
  });

  it("cualquier otro periodo excluye las tareas sin fecha", () => {
    expect(matchPeriodo(null, "hoy_vencido", NOW)).toBe(false);
    expect(matchPeriodo(null, "esta_semana", NOW)).toBe(false);
  });

  it("hoy y vencido: hoy y antes, no mañana", () => {
    expect(matchPeriodo(dia("2026-10-08"), "hoy_vencido", NOW)).toBe(true);
    expect(matchPeriodo(dia("2026-09-01"), "hoy_vencido", NOW)).toBe(true);
    expect(matchPeriodo(dia("2026-10-09"), "hoy_vencido", NOW)).toBe(false);
  });

  it("hoy, mañana y vencido son excluyentes", () => {
    expect(matchPeriodo(dia("2026-10-08"), "hoy", NOW)).toBe(true);
    expect(matchPeriodo(dia("2026-10-09"), "hoy", NOW)).toBe(false);
    expect(matchPeriodo(dia("2026-10-09"), "manana", NOW)).toBe(true);
    expect(matchPeriodo(dia("2026-10-08"), "vencido", NOW)).toBe(false);
    expect(matchPeriodo(dia("2026-10-07"), "vencido", NOW)).toBe(true);
  });

  it("usa el día civil de Cancún, no el de UTC", () => {
    // 02:00Z del 9 son las 21:00 del 8 en Cancún: sigue siendo hoy.
    expect(matchPeriodo("2026-10-09T02:00:00.000Z", "hoy", NOW)).toBe(true);
    expect(matchPeriodo("2026-10-09T02:00:00.000Z", "manana", NOW)).toBe(false);
  });

  it("esta semana va de lunes a domingo", () => {
    expect(matchPeriodo(dia("2026-10-05"), "esta_semana", NOW)).toBe(true); // lunes
    expect(matchPeriodo(dia("2026-10-11"), "esta_semana", NOW)).toBe(true); // domingo
    expect(matchPeriodo(dia("2026-10-04"), "esta_semana", NOW)).toBe(false);
    expect(matchPeriodo(dia("2026-10-12"), "esta_semana", NOW)).toBe(false);
  });

  it("el domingo pertenece a la semana que termina, no a la siguiente", () => {
    const domingo = new Date("2026-10-11T17:00:00.000Z");
    expect(matchPeriodo(dia("2026-10-05"), "esta_semana", domingo)).toBe(true);
    expect(matchPeriodo(dia("2026-10-12"), "siguiente_semana", domingo)).toBe(true);
  });

  it("siguiente semana", () => {
    expect(matchPeriodo(dia("2026-10-12"), "siguiente_semana", NOW)).toBe(true);
    expect(matchPeriodo(dia("2026-10-18"), "siguiente_semana", NOW)).toBe(true);
    expect(matchPeriodo(dia("2026-10-19"), "siguiente_semana", NOW)).toBe(false);
    expect(matchPeriodo(dia("2026-10-11"), "siguiente_semana", NOW)).toBe(false);
  });

  it("este mes y siguiente mes", () => {
    expect(matchPeriodo(dia("2026-10-31"), "este_mes", NOW)).toBe(true);
    expect(matchPeriodo(dia("2026-11-01"), "este_mes", NOW)).toBe(false);
    expect(matchPeriodo(dia("2026-11-15"), "siguiente_mes", NOW)).toBe(true);
    expect(matchPeriodo(dia("2026-12-01"), "siguiente_mes", NOW)).toBe(false);
  });

  it("siguiente mes cruza el cambio de año", () => {
    const diciembre = new Date("2026-12-15T17:00:00.000Z");
    expect(matchPeriodo(dia("2027-01-10"), "siguiente_mes", diciembre)).toBe(true);
    expect(matchPeriodo(dia("2026-12-20"), "siguiente_mes", diciembre)).toBe(false);
  });

  it("fecha específica compara contra la clave recibida", () => {
    expect(matchPeriodo(dia("2026-10-20"), "fecha", NOW, "2026-10-20")).toBe(true);
    expect(matchPeriodo(dia("2026-10-21"), "fecha", NOW, "2026-10-20")).toBe(false);
    expect(matchPeriodo(dia("2026-10-20"), "fecha", NOW)).toBe(false);
  });

  it("una fecha ilegible no cae en ningún periodo acotado", () => {
    expect(matchPeriodo("no-es-fecha", "hoy", NOW)).toBe(false);
  });
});

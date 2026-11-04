import { describe, it, expect } from "vitest";
import { validarPasoCampo, resumenPaso1 } from "./asistente-campo";

const b = { label: "Notaría", fieldType: "TEXT", options: "" };

describe("validarPasoCampo", () => {
  it("paso 1 exige etiqueta", () => {
    expect(validarPasoCampo(1, { ...b, label: "  " }).label).toBeTruthy();
    expect(validarPasoCampo(1, b)).toEqual({});
  });
  it("paso 1 exige tipo", () => {
    expect(validarPasoCampo(1, { ...b, fieldType: "" }).fieldType).toBeTruthy();
  });
  it("paso 2 exige opciones solo en listas", () => {
    expect(validarPasoCampo(2, b)).toEqual({});
    expect(validarPasoCampo(2, { ...b, fieldType: "PICKLIST" }).options).toBeTruthy();
    expect(validarPasoCampo(2, { ...b, fieldType: "PICKLIST", options: " , " }).options).toBeTruthy();
    expect(validarPasoCampo(2, { ...b, fieldType: "PICKLIST", options: "A, B" })).toEqual({});
  });
  it("resumen", () => {
    expect(resumenPaso1({ label: " Notaría ", fieldType: "TEXT" }, "Texto")).toBe("Notaría · Texto");
  });
});

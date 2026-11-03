import { describe, it, expect } from "vitest";
import { buildExtractionSchema, parseExtractionResponse } from "./extract";

const tasks = [
  { key: "nombre", objective: "pide nombre", captureType: "FULL_NAME" },
  { key: "presupuesto", objective: "pide presupuesto", captureType: "BUDGET_RANGE" },
];

describe("buildExtractionSchema", () => {
  it("genera json_schema con una propiedad string|null por task.key, todas required, additionalProperties false", () => {
    const s = buildExtractionSchema(tasks) as any;
    expect(s.type).toBe("object");
    expect(s.additionalProperties).toBe(false);
    expect(Object.keys(s.properties)).toEqual(["nombre", "presupuesto"]);
    expect(s.properties.nombre.type).toEqual(["string", "null"]);
    expect(s.required.sort()).toEqual(["nombre", "presupuesto"]);
  });

  it("si la tarea trae extractionHint, la pista va en la descripción que ve Claude", () => {
    const s = buildExtractionSchema([
      { key: "colchon", objective: "pregunta meses de colchón", captureType: "ENUM", extractionHint: "Convierte meses a rango." },
      { key: "nombre", objective: "pide nombre", captureType: "FULL_NAME" },
    ]) as any;
    expect(s.properties.colchon.description).toContain("pregunta meses de colchón");
    expect(s.properties.colchon.description).toContain("Convierte meses a rango.");
    expect(s.properties.nombre.description).toBe("pide nombre");
  });
});

describe("parseExtractionResponse", () => {
  it("parsea JSON plano", () => {
    expect(parseExtractionResponse('{"nombre":"Ana","presupuesto":null}')).toEqual({ nombre: "Ana", presupuesto: null });
  });
  it("limpia fences ```json", () => {
    expect(parseExtractionResponse('```json\n{"nombre":"Ana"}\n```')).toEqual({ nombre: "Ana" });
  });
  it("devuelve {} ante texto no-JSON", () => {
    expect(parseExtractionResponse("no es json")).toEqual({});
  });
});

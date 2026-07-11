import { describe, it, expect } from "vitest";
import type { CaptureType } from "@prisma/client";
import { coerceCapture } from "./capture";
import type { CaptureTask, EnumOption } from "./capture";

function task(captureType: CaptureType, targetField = "field", enumOptions?: EnumOption[]): CaptureTask {
  return { targetField, captureType, enumOptions };
}

describe("coerceCapture", () => {
  describe("TEXT", () => {
    it("recorta espacios y escribe el valor", () => {
      const r = coerceCapture(task("TEXT", "notes"), "  hola mundo  ");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([{ field: "notes", value: "hola mundo" }]);
    });
    it("vacío -> not ok", () => {
      const r = coerceCapture(task("TEXT", "notes"), "   ");
      expect(r.ok).toBe(false);
      expect(r.writes).toEqual([]);
    });
  });

  describe("FULL_NAME", () => {
    it('"Ana María Pérez" -> firstName "Ana", lastName "María Pérez"', () => {
      const r = coerceCapture(task("FULL_NAME", "ignoredField"), "Ana María Pérez");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([
        { field: "firstName", value: "Ana" },
        { field: "lastName", value: "María Pérez" },
      ]);
    });
    it('"Ana" (un solo token) -> firstName "Ana", lastName ""', () => {
      const r = coerceCapture(task("FULL_NAME", "ignoredField"), "Ana");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([
        { field: "firstName", value: "Ana" },
        { field: "lastName", value: "" },
      ]);
    });
    it('"  " (vacío) -> not ok', () => {
      const r = coerceCapture(task("FULL_NAME", "ignoredField"), "  ");
      expect(r.ok).toBe(false);
      expect(r.writes).toEqual([]);
    });
  });

  describe("EMAIL", () => {
    it("email válido -> ok y en minúsculas", () => {
      const r = coerceCapture(task("EMAIL", "email"), "Juan@Example.COM");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([{ field: "email", value: "juan@example.com" }]);
    });
    it("email válido embebido en frase -> lo extrae", () => {
      const r = coerceCapture(task("EMAIL", "email"), "mi correo es Ana@Test.mx porfa");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([{ field: "email", value: "ana@test.mx" }]);
    });
    it("inválido -> not ok", () => {
      const r = coerceCapture(task("EMAIL", "email"), "no tengo correo");
      expect(r.ok).toBe(false);
      expect(r.writes).toEqual([]);
    });
  });

  describe("PHONE", () => {
    it('"tel 9981234567" -> ok, reusa normalizador de @/lib/phone', () => {
      const r = coerceCapture(task("PHONE", "phone"), "tel 9981234567");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([{ field: "phone", value: "+529981234567" }]);
    });
    it('"123" (muy corto) -> not ok', () => {
      const r = coerceCapture(task("PHONE", "phone"), "123");
      expect(r.ok).toBe(false);
      expect(r.writes).toEqual([]);
    });
  });

  describe("MONEY (targetField budgetMax)", () => {
    it('"3000000" -> 3000000', () => {
      const r = coerceCapture(task("MONEY", "budgetMax"), "3000000");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([{ field: "budgetMax", value: 3000000 }]);
    });
    it('"3,000,000" -> 3000000', () => {
      const r = coerceCapture(task("MONEY", "budgetMax"), "3,000,000");
      expect(r.writes).toEqual([{ field: "budgetMax", value: 3000000 }]);
    });
    it('"3 millones" -> 3000000', () => {
      const r = coerceCapture(task("MONEY", "budgetMax"), "3 millones");
      expect(r.writes).toEqual([{ field: "budgetMax", value: 3000000 }]);
    });
    it('"3 millón" -> 3000000', () => {
      const r = coerceCapture(task("MONEY", "budgetMax"), "3 millón");
      expect(r.writes).toEqual([{ field: "budgetMax", value: 3000000 }]);
    });
    it('"3 mdp" -> 3000000', () => {
      const r = coerceCapture(task("MONEY", "budgetMax"), "3 mdp");
      expect(r.writes).toEqual([{ field: "budgetMax", value: 3000000 }]);
    });
    it('"2.5 mdp" -> 2500000', () => {
      const r = coerceCapture(task("MONEY", "budgetMax"), "2.5 mdp");
      expect(r.writes).toEqual([{ field: "budgetMax", value: 2500000 }]);
    });
    it('"2.5 millones" -> 2500000', () => {
      const r = coerceCapture(task("MONEY", "budgetMax"), "2.5 millones");
      expect(r.writes).toEqual([{ field: "budgetMax", value: 2500000 }]);
    });
    it('"500 mil" -> 500000', () => {
      const r = coerceCapture(task("MONEY", "budgetMax"), "500 mil");
      expect(r.writes).toEqual([{ field: "budgetMax", value: 500000 }]);
    });
    it('"500k" -> 500000', () => {
      const r = coerceCapture(task("MONEY", "budgetMax"), "500k");
      expect(r.writes).toEqual([{ field: "budgetMax", value: 500000 }]);
    });
    it('"$3,200,000" -> 3200000', () => {
      const r = coerceCapture(task("MONEY", "budgetMax"), "$3,200,000");
      expect(r.writes).toEqual([{ field: "budgetMax", value: 3200000 }]);
    });
    it('"hola" (sin número) -> not ok', () => {
      const r = coerceCapture(task("MONEY", "budgetMax"), "hola");
      expect(r.ok).toBe(false);
      expect(r.writes).toEqual([]);
    });
  });

  describe("BUDGET_RANGE", () => {
    it('"entre 2 y 3 millones" -> min 2000000 / max 3000000', () => {
      const r = coerceCapture(task("BUDGET_RANGE", "ignoredField"), "entre 2 y 3 millones");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([
        { field: "budgetMin", value: 2000000 },
        { field: "budgetMax", value: 3000000 },
      ]);
    });
    it('"2 a 3 mdp" -> min 2000000 / max 3000000', () => {
      const r = coerceCapture(task("BUDGET_RANGE", "ignoredField"), "2 a 3 mdp");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([
        { field: "budgetMin", value: 2000000 },
        { field: "budgetMax", value: 3000000 },
      ]);
    });
    it('"como 2.5 mdp" (un solo monto) -> ambos 2500000', () => {
      const r = coerceCapture(task("BUDGET_RANGE", "ignoredField"), "como 2.5 mdp");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([
        { field: "budgetMin", value: 2500000 },
        { field: "budgetMax", value: 2500000 },
      ]);
    });
    it('"máximo 3 millones" (un solo monto) -> ambos 3000000', () => {
      const r = coerceCapture(task("BUDGET_RANGE", "ignoredField"), "máximo 3 millones");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([
        { field: "budgetMin", value: 3000000 },
        { field: "budgetMax", value: 3000000 },
      ]);
    });
    it('"no sé" -> not ok', () => {
      const r = coerceCapture(task("BUDGET_RANGE", "ignoredField"), "no sé");
      expect(r.ok).toBe(false);
      expect(r.writes).toEqual([]);
    });
  });

  describe("ENUM (propertyType con sinónimos)", () => {
    const enumOptions: EnumOption[] = [
      { value: "DEPARTAMENTO", synonyms: ["depa", "departamento"] },
      { value: "CASA", synonyms: ["casa"] },
      { value: "TERRENO", synonyms: ["terreno", "lote"] },
    ];

    it('"busco un depa" -> DEPARTAMENTO', () => {
      const r = coerceCapture(task("ENUM", "propertyType", enumOptions), "busco un depa");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([{ field: "propertyType", value: "DEPARTAMENTO" }]);
    });
    it('"quiero una casita" -> CASA (contains "casa" dentro de "casita")', () => {
      const r = coerceCapture(task("ENUM", "propertyType", enumOptions), "quiero una casita");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([{ field: "propertyType", value: "CASA" }]);
    });
    it('"un lote en la selva" -> TERRENO', () => {
      const r = coerceCapture(task("ENUM", "propertyType", enumOptions), "un lote en la selva");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([{ field: "propertyType", value: "TERRENO" }]);
    });
    it('"un yate" -> not ok (sin match)', () => {
      const r = coerceCapture(task("ENUM", "propertyType", enumOptions), "un yate");
      expect(r.ok).toBe(false);
      expect(r.writes).toEqual([]);
    });
    it("sin enumOptions -> not ok", () => {
      const r = coerceCapture(task("ENUM", "propertyType"), "depa");
      expect(r.ok).toBe(false);
      expect(r.writes).toEqual([]);
    });
  });

  describe("ZONE", () => {
    it('"Tulum centro" -> ok, recortado', () => {
      const r = coerceCapture(task("ZONE", "preferredZone"), "  Tulum centro  ");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([{ field: "preferredZone", value: "Tulum centro" }]);
    });
    it("vacío -> not ok", () => {
      const r = coerceCapture(task("ZONE", "preferredZone"), "   ");
      expect(r.ok).toBe(false);
      expect(r.writes).toEqual([]);
    });
  });

  describe("BOOLEAN", () => {
    it('"sí, claro" -> true', () => {
      const r = coerceCapture(task("BOOLEAN", "flag"), "sí, claro");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([{ field: "flag", value: true }]);
    });
    it('"no gracias" -> false', () => {
      const r = coerceCapture(task("BOOLEAN", "flag"), "no gracias");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([{ field: "flag", value: false }]);
    });
    it('"para nada" -> not ok (sin token explícito sí/no)', () => {
      const r = coerceCapture(task("BOOLEAN", "flag"), "para nada");
      expect(r.ok).toBe(false);
      expect(r.writes).toEqual([]);
    });
  });

  describe("NUMBER", () => {
    it('"3 recámaras" -> 3', () => {
      const r = coerceCapture(task("NUMBER", "bedrooms"), "3 recámaras");
      expect(r.ok).toBe(true);
      expect(r.writes).toEqual([{ field: "bedrooms", value: 3 }]);
    });
    it('"dos" (sin dígitos) -> not ok', () => {
      const r = coerceCapture(task("NUMBER", "bedrooms"), "dos");
      expect(r.ok).toBe(false);
      expect(r.writes).toEqual([]);
    });
  });
});

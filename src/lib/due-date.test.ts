import { describe, it, expect, vi, afterEach } from "vitest";
import { parseDueDate, dueDateSchema } from "./due-date";

describe("parseDueDate", () => {
  it("ancla una fecha sin hora a medianoche de Cancún (bug A)", () => {
    // Medianoche de Cancún (UTC−5) son las 05:00Z. Con z.coerce.date() o
    // new Date(value) a secas esto sería 2026-07-29T19:00 en Cancún.
    expect(parseDueDate("2026-07-30")?.toISOString()).toBe("2026-07-30T05:00:00.000Z");
  });

  it("ancla un datetime local sin zona a la hora de pared de Cancún (bug B)", () => {
    // <input type="datetime-local"> manda esto crudo. new Date(value) a
    // secas dependería de la TZ del proceso — este es el bug grave.
    expect(parseDueDate("2026-07-30T14:30")?.toISOString()).toBe("2026-07-30T19:30:00.000Z");
  });

  it("ancla igual con segundos explícitos", () => {
    expect(parseDueDate("2026-07-30T14:30:00")?.toISOString()).toBe("2026-07-30T19:30:00.000Z");
  });

  it("respeta un datetime con Z tal cual", () => {
    expect(parseDueDate("2026-07-30T14:30:00Z")?.toISOString()).toBe("2026-07-30T14:30:00.000Z");
  });

  it("respeta un datetime con offset con dos puntos tal cual", () => {
    expect(parseDueDate("2026-07-30T14:30:00-05:00")?.toISOString()).toBe(
      "2026-07-30T19:30:00.000Z",
    );
  });

  it("respeta un datetime con offset sin dos puntos tal cual", () => {
    expect(parseDueDate("2026-07-30T14:30:00-0500")?.toISOString()).toBe(
      "2026-07-30T19:30:00.000Z",
    );
  });

  it("rechaza una fecha de calendario imposible (30 de febrero), con o sin zona", () => {
    expect(parseDueDate("2026-02-30")).toBeNull();
    expect(parseDueDate("2026-02-30T10:00:00Z")).toBeNull();
  });

  it("rechaza el 29 de febrero de un año no bisiesto y acepta el de uno bisiesto", () => {
    expect(parseDueDate("2026-02-29")).toBeNull();
    expect(parseDueDate("2024-02-29")).toBeInstanceOf(Date);
  });

  it("rechaza un string ilegible", () => {
    expect(parseDueDate("no-es-fecha")).toBeNull();
  });

  it("no da falso positivo de zona por el '-30' final de una fecha sola", () => {
    // Si la detección de zona fuera un regex laxo (ej. /[+-]\d\d$/), "2026-07-30"
    // se leería como si trajera un offset de solo 2 dígitos y se pasaría a
    // new Date(value) a secas en vez de anclarse a Cancún.
    expect(parseDueDate("2026-07-30")?.toISOString()).toBe("2026-07-30T05:00:00.000Z");
  });

  describe("independencia de la zona horaria del proceso (bug B, verificación directa)", () => {
    // El resultado es determinista por construcción, no por casualidad del
    // entorno de test: la rama "sin zona" siempre concatena un offset de
    // Cancún explícito (derivado vía Intl con timeZone: CANCUN_TZ fijo)
    // antes de invocar `new Date(...)`, así que el string que llega al
    // parser de Date SIEMPRE trae su propia zona explícita. `new Date` con
    // zona explícita en el string ignora la TZ del proceso en Node/V8 — es
    // el mismo mecanismo que arregla el bug. Igualmente lo verificamos con
    // vi.stubEnv forzando distintas TZ de proceso, por si algún engine futuro
    // se comportara distinto.
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it.each(["America/Mexico_City", "UTC", "Pacific/Kiritimati"])(
      "da el mismo instante con process.env.TZ=%s",
      (tz) => {
        vi.stubEnv("TZ", tz);
        expect(parseDueDate("2026-07-30T14:30")?.toISOString()).toBe("2026-07-30T19:30:00.000Z");
      },
    );
  });
});

describe("dueDateSchema", () => {
  it("transforma un string válido en Date", () => {
    const result = dueDateSchema.parse("2026-07-30T14:30");
    expect(result.toISOString()).toBe("2026-07-30T19:30:00.000Z");
  });

  it("rechaza un string inválido con un mensaje claro", () => {
    const result = dueDateSchema.safeParse("2026-02-30");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Fecha inválida");
    }
  });
});

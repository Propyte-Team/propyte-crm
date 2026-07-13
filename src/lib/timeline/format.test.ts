import { describe, it, expect } from "vitest";
import { humanizeDuration, fieldChangeTitle } from "./format";

describe("humanizeDuration", () => {
  it("menos de 1 minuto → '<1m'", () => {
    expect(humanizeDuration(30_000)).toBe("<1m");
    expect(humanizeDuration(0)).toBe("<1m");
  });

  it("minutos sin horas → '45m'", () => {
    expect(humanizeDuration(45 * 60_000)).toBe("45m");
  });

  it("horas y minutos → '2h 15m'", () => {
    expect(humanizeDuration(2 * 3_600_000 + 15 * 60_000)).toBe("2h 15m");
  });

  it("horas exactas sin minutos → '2h'", () => {
    expect(humanizeDuration(2 * 3_600_000)).toBe("2h");
  });

  it("días y horas → '3d 4h'", () => {
    expect(humanizeDuration(3 * 86_400_000 + 4 * 3_600_000)).toBe("3d 4h");
  });

  it("días exactos sin horas → '3d'", () => {
    expect(humanizeDuration(3 * 86_400_000)).toBe("3d");
  });
});

describe("fieldChangeTitle", () => {
  it("título estilo Zoho para contactStatus usando CONTACT_STATUS_LABELS", () => {
    expect(fieldChangeTitle("contactStatus", "NUEVO", "CONTACTADO")).toBe(
      "Estado de contacto se actualizó de Nuevo a Contactado"
    );
  });

  it("mapea el label del campo temperature", () => {
    expect(fieldChangeTitle("temperature", "COLD", "HOT")).toBe(
      "Temperatura se actualizó de Frío a Caliente"
    );
  });

  it("mapea assignedToId con su label de campo (valores ya resueltos por el caller)", () => {
    expect(fieldChangeTitle("assignedToId", "Sin asignar", "Ana Pérez")).toBe(
      "Asignado a se actualizó de Sin asignar a Ana Pérez"
    );
  });

  it("campo sin mapa conocido usa el nombre crudo como fallback", () => {
    expect(fieldChangeTitle("customFieldX", "a", "b")).toBe(
      "customFieldX se actualizó de a a b"
    );
  });

  it("valor sin mapa conocido usa String(value) como fallback", () => {
    expect(fieldChangeTitle("score", 10, 25)).toBe("Puntuación se actualizó de 10 a 25");
  });

  it("valor null se muestra como '—'", () => {
    expect(fieldChangeTitle("urgency", null, "ALTA")).toBe("Urgencia se actualizó de — a Alta");
  });

  it("arreglos (tags) se listan separados por coma", () => {
    expect(fieldChangeTitle("tags", ["vip"], ["vip", "referido"])).toBe(
      "Etiquetas se actualizó de vip a vip, referido"
    );
  });
});

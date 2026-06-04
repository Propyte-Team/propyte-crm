import { describe, it, expect } from "vitest";
import { intakePayloadSchema } from "./schema";

const valid = {
  generales: { nombre: "Gobernador 28", tipo: "vertical", unidadesTotales: 126 },
  ubicacion: { ciudad: "Playa del Carmen", playaDistanciaValor: 7, playaDistanciaUnidad: "min" },
  amenidades: { flags: { amenidad_gym: true }, adicionales: ["Sauna"] },
  descripciones: { descripcionEs: "Desarrollo..." },
  tipologias: [{ etiqueta: "A", recamaras: 1, banosCompletos: 1, mediosBanos: 1, m2: 65.9, precioDesde: 2455628 }],
  multimedia: { tourVirtual: "https://kuula.co/x" },
  faq: [{ pregunta: "¿Dónde?", respuesta: "Playa del Carmen" }],
};

describe("intakePayloadSchema", () => {
  it("acepta un payload válido y aplica defaults", () => {
    const r = intakePayloadSchema.parse(valid);
    expect(r.generales.nombre).toBe("Gobernador 28");
    expect(r.tipologias[0].moneda).toBe("MXN");
    expect(r.tipologias[0].estado).toBe("Preventa");
  });
  it("rechaza si no hay tipologías", () => {
    expect(() => intakePayloadSchema.parse({ ...valid, tipologias: [] })).toThrow();
  });
  it("rechaza nombre vacío", () => {
    expect(() => intakePayloadSchema.parse({ ...valid, generales: { nombre: "" } })).toThrow();
  });
  it("rechaza unidad de distancia inválida", () => {
    expect(() =>
      intakePayloadSchema.parse({ ...valid, ubicacion: { playaDistanciaUnidad: "minutos" } })
    ).toThrow();
  });
});

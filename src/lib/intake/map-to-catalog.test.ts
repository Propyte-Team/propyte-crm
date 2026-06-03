import { describe, it, expect } from "vitest";
import { intakePayloadSchema } from "./schema";
import { mapPayloadToDevelopment, mapTypologyToUnit, mergeFillGaps } from "./map-to-catalog";

const payload = intakePayloadSchema.parse({
  generales: { nombre: "Gobernador 28", tipo: "vertical", unidadesTotales: 126, unidadesDisponibles: 19, fechaEntrega: "Mayo 2026" },
  ubicacion: { ciudad: "Playa del Carmen", estado: "Quintana Roo", playaDistanciaValor: 7, playaDistanciaUnidad: "min" },
  amenidades: { flags: { amenidad_gym: true, columna_invalida: true }, adicionales: ["Sauna"] },
  descripciones: { descripcionEs: "Desc" },
  tipologias: [
    { etiqueta: "A", recamaras: 1, banosCompletos: 1, mediosBanos: 1, m2: 65.9, precioDesde: 2455628 },
    { etiqueta: "B2", recamaras: 2, banosCompletos: 2, mediosBanos: 1, m2: 99.5, precioDesde: 3323250 },
  ],
  multimedia: {},
  faq: [{ pregunta: "¿Dónde?", respuesta: "PDC" }],
});

describe("mapPayloadToDevelopment", () => {
  const dev = mapPayloadToDevelopment(payload);
  it("mapea campos base y fuerza borrador", () => {
    expect(dev.nombre_desarrollo).toBe("Gobernador 28");
    expect(dev.ciudad).toBe("Playa del Carmen");
    expect(dev.ext_publicado).toBe(false);
    expect(dev.web_status).toBe("draft");
    expect(dev.last_source).toBe("intake-form");
  });
  it("calcula precio min/max desde tipologías", () => {
    expect(dev.ext_precio_min_mxn).toBe(2455628);
    expect(dev.ext_precio_max_mxn).toBe(3323250);
  });
  it("aplica solo flags de amenidad en whitelist", () => {
    expect(dev.amenidad_gym).toBe(true);
    expect("columna_invalida" in dev).toBe(false);
  });
  it("arma ext_content_es.faq", () => {
    expect((dev.ext_content_es as any).faq[0]).toEqual({ question: "¿Dónde?", answer: "PDC" });
  });
});

describe("mapTypologyToUnit", () => {
  it("mapea tipología a fila de unidad", () => {
    const u = mapTypologyToUnit(payload.tipologias[0], "dev-uuid", "Gobernador 28");
    expect(u.id_desarrollo).toBe("dev-uuid");
    expect(u.recamaras).toBe(1);
    expect(u.medios_banos).toBe(1);
    expect(u.superficie_total_m2).toBe(65.9);
    expect(u.precio_desde).toBe(2455628);
    expect(u.estado_unidad).toBe("Preventa");
    expect(u.es_preventa).toBe(true);
    expect(u.ext_publicado).toBe(false);
    expect(u.titulo_unidad).toContain("Gobernador 28");
    expect(u.titulo_unidad).toContain("A");
  });
});

describe("mergeFillGaps", () => {
  it("conserva valor existente cuando el entrante viene vacío", () => {
    const out = mergeFillGaps(
      { ciudad: "Playa del Carmen", colonia: "Centro" },
      { ciudad: "Playa del Carmen", colonia: null }
    );
    expect(out.colonia).toBe("Centro");
  });
  it("usa el entrante cuando trae valor", () => {
    const out = mergeFillGaps({ ciudad: "Cancún" }, { ciudad: "Playa del Carmen" });
    expect(out.ciudad).toBe("Playa del Carmen");
  });
});

import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./claude";
import { DEFAULT_BOT_CONFIG } from "./config";

const CATALOG = [{
  id: "d1", nombre: "Nativa Tulum", zona: "Tulum", ciudad: "Tulum", precio_min: 2500000, precio_max: 6300000,
  moneda: "MXN", unidades_publicadas: 6, recamaras_min: 1, recamaras_max: 3, enganche_pct: 30, meses_opciones: [12, 24],
}];

describe("buildSystemPrompt — sin marca (camino de siempre)", () => {
  it("es idéntico al prompt de antes del cambio (congelado)", () => {
    const out = buildSystemPrompt({
      config: DEFAULT_BOT_CONFIG,
      contact: { firstName: "Ana", preferredLanguage: "ES" },
      catalog: CATALOG,
      objective: "Saluda y califica.",
    });
    expect(out).toMatchSnapshot();
  });
  it("sin catálogo, idéntico al de antes", () => {
    expect(buildSystemPrompt({ config: DEFAULT_BOT_CONFIG })).toMatchSnapshot();
  });
});

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

const YAX = {
  name: "Yaxnáh Caucel",
  persona: "Eres el asistente comercial de Yaxnáh Caucel, fraccionamiento de casas en Ciudad Caucel, Mérida.",
  knowledge: "Kannah Etapa 6: $2,020,000. Nunca menciones el bono de $60,000.",
};

describe("buildSystemPrompt — con marca", () => {
  const out = buildSystemPrompt({
    config: DEFAULT_BOT_CONFIG,
    contact: { firstName: "Ana", preferredLanguage: "ES" },
    catalog: [{ ...CATALOG[0], nombre: "Yaxnáh Caucel", zona: "Caucel", ciudad: "Mérida" }],
    objective: "Saluda y califica.",
    brand: YAX,
  });
  it("no menciona Propyte, Riviera Maya ni Tulum", () => {
    expect(out).not.toMatch(/Propyte|Riviera Maya|Tulum/);
  });
  it("usa la presentación, la regla de exclusividad y el conocimiento", () => {
    expect(out).toContain(YAX.persona);
    expect(out).toContain("Representas únicamente a Yaxnáh Caucel.");
    expect(out).toContain("Información oficial de Yaxnáh Caucel");
    expect(out).toContain(YAX.knowledge);
    expect(out).toContain("Catálogo oficial de Yaxnáh Caucel");
  });
  it("conserva las reglas de seguridad", () => {
    expect(out).toContain("[ESCALAR]");
    expect(out).toContain("[ESCALAR_MARKETING]");
    expect(out).toContain("ese \"sí\" ES intención fuerte");
    expect(out).toContain("NO inventes cifras");
  });
  it("sin ejemplos de tono (todos son de Tulum)", () => {
    expect(out).not.toContain("Ejemplos de tu estilo");
  });
  it("persona vacía → presentación genérica con el nombre", () => {
    const o = buildSystemPrompt({ config: DEFAULT_BOT_CONFIG, brand: { ...YAX, persona: "  " } });
    expect(o).toContain("Eres el asistente comercial de Yaxnáh Caucel.");
  });
  it("sin conocimiento → no agrega el bloque vacío", () => {
    const o = buildSystemPrompt({ config: DEFAULT_BOT_CONFIG, brand: { ...YAX, knowledge: null } });
    expect(o).not.toContain("Información oficial de");
  });
});

describe("buildSystemPrompt — idioma", () => {
  const SIGUE_AL_CLIENTE = "si escribe en inglés contesta en inglés";
  const conMarca = (slug?: string) =>
    buildSystemPrompt({
      config: DEFAULT_BOT_CONFIG,
      contact: { firstName: "Eli", preferredLanguage: "EN" },
      objective: "Saluda y califica.",
      brand: { ...YAX, ...(slug ? { slug } : {}) },
    });

  it("Yaxnáh (slug yaxnah) contesta SIEMPRE en español, aunque el cliente escriba en inglés", () => {
    const out = conMarca("yaxnah");
    expect(out).toContain("Responde SIEMPRE en español, sin excepción");
    expect(out).toContain("aunque haya llenado el formulario en inglés");
    expect(out).not.toContain(SIGUE_AL_CLIENTE);
    // el idioma registrado (EN) no se le menciona: no debe abrir la puerta al inglés
    expect(out).not.toContain("Idioma registrado");
    expect(out).toContain("Cliente: Eli · Contesta en español.");
  });

  it("no depende del nombre: aunque la marca se renombre, manda el slug", () => {
    const out = buildSystemPrompt({ config: DEFAULT_BOT_CONFIG, brand: { ...YAX, name: "Yaxnáh", slug: "yaxnah" } });
    expect(out).toContain("Responde SIEMPRE en español, sin excepción");
  });

  it("otra marca sigue contestando en el idioma del cliente", () => {
    const out = conMarca("avica");
    expect(out).toContain(SIGUE_AL_CLIENTE);
    expect(out).not.toContain("Responde SIEMPRE en español");
    expect(out).toContain("Idioma registrado: EN (solo referencia");
  });

  it("marca sin slug (llamador viejo) → regla de siempre", () => {
    expect(conMarca()).toContain(SIGUE_AL_CLIENTE);
  });

  it("sin marca (Propyte) → regla de siempre", () => {
    const out = buildSystemPrompt({
      config: DEFAULT_BOT_CONFIG,
      contact: { firstName: "Eli", preferredLanguage: "EN" },
    });
    expect(out).toContain(SIGUE_AL_CLIENTE);
    expect(out).not.toContain("Responde SIEMPRE en español");
  });
});

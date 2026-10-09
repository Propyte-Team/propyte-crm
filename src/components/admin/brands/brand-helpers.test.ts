// Pruebas de las utilidades puras de la pestaña "Marcas del agente" (2026-10-09).
import { describe, it, expect } from "vitest";
import {
  suggestSlug,
  isValidSlug,
  parseChannels,
  emptyBrandForm,
  brandToForm,
  validateBrandForm,
  buildBrandPayload,
  apiErrorMessage,
  type BrandRow,
} from "./brand-helpers";

const brand: BrandRow = {
  id: "b1",
  name: "Nativa Tulum",
  slug: "nativa-tulum",
  isDefault: false,
  persona: "Eres el asistente comercial de Nativa.",
  knowledge: "Precios vigentes",
  developmentIds: ["11111111-1111-4111-8111-111111111111"],
  defaultPlaza: "TULUM",
  enabledChannels: ["WHATSAPP", "INSTAGRAM"],
  tonePreset: "CALIDO_CERCANO_MX",
  playbookId: "22222222-2222-4222-8222-222222222222",
  marketingOwnerUserId: null,
  botEnabled: true,
  connectors: [],
};

describe("suggestSlug", () => {
  it("minúsculas y espacios → guion", () => {
    expect(suggestSlug("Nativa Tulum")).toBe("nativa-tulum");
  });
  it("quita acentos y la ñ", () => {
    expect(suggestSlug("Propyte Mérida")).toBe("propyte-merida");
    expect(suggestSlug("ÁÉÍÓÚ Año")).toBe("aeiou-ano");
  });
  it("colapsa símbolos y espacios repetidos, sin guiones en los extremos", () => {
    expect(suggestSlug("  ¡Casa   del  Mar!! ")).toBe("casa-del-mar");
    expect(suggestSlug("A & B")).toBe("a-b");
  });
  it("respeta el máximo de 40 y no termina en guion", () => {
    const slug = suggestSlug("Una marca con un nombre larguísimo que excede el límite permitido");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
    expect(isValidSlug(slug)).toBe(true);
  });
  it("nombre vacío o solo símbolos → cadena vacía", () => {
    expect(suggestSlug("")).toBe("");
    expect(suggestSlug("!!!")).toBe("");
  });
});

describe("isValidSlug", () => {
  it("acepta lo que acepta el API", () => {
    expect(isValidSlug("nativa-tulum")).toBe(true);
    expect(isValidSlug("ab")).toBe(true);
  });
  it("rechaza mayúsculas, espacios, acentos, muy corto o muy largo", () => {
    expect(isValidSlug("Nativa")).toBe(false);
    expect(isValidSlug("a b")).toBe(false);
    expect(isValidSlug("méxico")).toBe(false);
    expect(isValidSlug("a")).toBe(false);
    expect(isValidSlug("a".repeat(41))).toBe(false);
  });
});

describe("parseChannels", () => {
  it("null/no-arreglo → null (hereda los globales)", () => {
    expect(parseChannels(null)).toBeNull();
    expect(parseChannels(undefined)).toBeNull();
    expect(parseChannels("WHATSAPP")).toBeNull();
  });
  it("filtra valores desconocidos", () => {
    expect(parseChannels(["WHATSAPP", "SMS", 3, "MESSENGER"])).toEqual(["WHATSAPP", "MESSENGER"]);
  });
  it("arreglo vacío se conserva (ningún canal)", () => {
    expect(parseChannels([])).toEqual([]);
  });
});

describe("brandToForm", () => {
  it("canales guardados → no usa los globales", () => {
    const f = brandToForm(brand);
    expect(f.useGlobalChannels).toBe(false);
    expect(f.channels).toEqual(["WHATSAPP", "INSTAGRAM"]);
    expect(f.slugTouched).toBe(true);
  });
  it("enabledChannels null → usa los globales", () => {
    const f = brandToForm({ ...brand, enabledChannels: null });
    expect(f.useGlobalChannels).toBe(true);
    expect(f.channels).toEqual([]);
  });
  it("nulos de la base → cadenas vacías del formulario", () => {
    const f = brandToForm({ ...brand, persona: null, knowledge: null, defaultPlaza: null, tonePreset: null, playbookId: null });
    expect([f.persona, f.knowledge, f.defaultPlaza, f.tonePreset, f.playbookId]).toEqual(["", "", "", "", ""]);
  });
});

describe("validateBrandForm", () => {
  const ok = { ...emptyBrandForm(), name: "Nativa", slug: "nativa" };
  it("formulario válido → null", () => {
    expect(validateBrandForm(ok, "create")).toBeNull();
  });
  it("nombre corto o largo", () => {
    expect(validateBrandForm({ ...ok, name: " a " }, "create")).toMatch(/nombre/);
    expect(validateBrandForm({ ...ok, name: "x".repeat(81) }, "edit")).toMatch(/nombre/);
  });
  it("slug inválido solo se exige al crear", () => {
    expect(validateBrandForm({ ...ok, slug: "Mala Marca" }, "create")).toMatch(/identificador/);
    expect(validateBrandForm({ ...ok, slug: "Mala Marca" }, "edit")).toBeNull();
  });
  it("la predeterminada solo valida el nombre", () => {
    expect(validateBrandForm({ ...ok, slug: "", persona: "x".repeat(5000) }, "edit-default")).toBeNull();
  });
  it("sin 'Usar los globales' y sin ningún canal marcado → error (no se guarda [])", () => {
    const msg = "Elige al menos un canal o marca «Usar los globales».";
    expect(validateBrandForm({ ...ok, useGlobalChannels: false, channels: [] }, "create")).toBe(msg);
    expect(validateBrandForm({ ...brandToForm(brand), useGlobalChannels: false, channels: [] }, "edit")).toBe(msg);
  });
  it("con 'Usar los globales' o con al menos un canal → pasa", () => {
    expect(validateBrandForm({ ...ok, useGlobalChannels: true, channels: [] }, "create")).toBeNull();
    expect(validateBrandForm({ ...ok, useGlobalChannels: false, channels: ["WHATSAPP"] }, "create")).toBeNull();
  });
  it("la predeterminada no valida canales (solo manda el nombre)", () => {
    expect(validateBrandForm({ ...ok, useGlobalChannels: false, channels: [] }, "edit-default")).toBeNull();
  });
  it("límites de texto y de desarrollos", () => {
    expect(validateBrandForm({ ...ok, persona: "x".repeat(2001) }, "create")).toMatch(/presentación/);
    expect(validateBrandForm({ ...ok, knowledge: "x".repeat(20001) }, "create")).toMatch(/conocimiento/);
    expect(validateBrandForm({ ...ok, developmentIds: Array(21).fill("id") }, "create")).toMatch(/desarrollos/);
  });
});

describe("buildBrandPayload", () => {
  it("CREATE nunca manda botEnabled, aunque el formulario lo traiga en true", () => {
    const payload = buildBrandPayload({ ...emptyBrandForm(), name: " Nativa ", slug: "nativa", botEnabled: true }, "create");
    expect("botEnabled" in payload).toBe(false);
    expect(payload.slug).toBe("nativa");
    expect(payload.name).toBe("Nativa");
  });
  it("CREATE traduce vacíos a null y 'usar globales' a enabledChannels null", () => {
    const payload = buildBrandPayload({ ...emptyBrandForm(), name: "Nativa", slug: "nativa" }, "create");
    expect(payload).toMatchObject({
      persona: null, knowledge: null, defaultPlaza: null, enabledChannels: null,
      tonePreset: null, playbookId: null, marketingOwnerUserId: null, developmentIds: [],
    });
  });
  it("EDIT manda botEnabled y no manda slug", () => {
    const payload = buildBrandPayload(brandToForm(brand), "edit");
    expect(payload.botEnabled).toBe(true);
    expect("slug" in payload).toBe(false);
    expect(payload.enabledChannels).toEqual(["WHATSAPP", "INSTAGRAM"]);
    expect(payload.defaultPlaza).toBe("TULUM");
  });
  it("el armado no valida: canales propios vacíos saldrían como [] (validateBrandForm los frena antes de enviar)", () => {
    const payload = buildBrandPayload({ ...brandToForm(brand), useGlobalChannels: false, channels: [] }, "edit");
    expect(payload.enabledChannels).toEqual([]);
  });
  it("el sentinel 'none' de los selects se traduce a null", () => {
    const payload = buildBrandPayload({ ...brandToForm(brand), tonePreset: "none", playbookId: "none", defaultPlaza: "none" }, "edit");
    expect(payload).toMatchObject({ tonePreset: null, playbookId: null, defaultPlaza: null });
  });
  it("la predeterminada solo manda name", () => {
    const payload = buildBrandPayload({ ...brandToForm({ ...brand, isDefault: true }), name: " Propyte " }, "edit-default");
    expect(payload).toEqual({ name: "Propyte" });
  });
});

describe("apiErrorMessage", () => {
  it("error de texto", () => {
    expect(apiErrorMessage({ error: "Ya existe una marca con ese nombre" }, "x")).toBe("Ya existe una marca con ese nombre");
  });
  it("error de zod (flatten)", () => {
    const data = { error: { formErrors: [], fieldErrors: { slug: ["Solo minúsculas"], name: ["Muy corto"] } } };
    expect(apiErrorMessage(data, "x")).toBe("slug: Solo minúsculas; name: Muy corto");
  });
  it("sin información útil → fallback", () => {
    expect(apiErrorMessage({}, "No se pudo guardar")).toBe("No se pudo guardar");
    expect(apiErrorMessage(null, "No se pudo guardar")).toBe("No se pudo guardar");
    expect(apiErrorMessage({ error: { formErrors: [], fieldErrors: {} } }, "fb")).toBe("fb");
  });
});

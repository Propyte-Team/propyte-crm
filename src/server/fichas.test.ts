import { describe, it, expect, vi, beforeEach } from "vitest";

// #887 — Ficha técnica compartible, la parte de servidor:
//   - el enlace es uno por asesor y propiedad, y se crea con el id canónico del Hub;
//   - una unidad no se puede pegar a otro desarrollo;
//   - abrir la ficha muestra al asesor que la CREÓ, no a quien la reenvió (no hay "quien la
//     reenvió" en el modelo: es el mismo token);
//   - un fallo del catálogo no se disfraza de "no existe" (#716).

const upsert = vi.fn();
const findUnique = vi.fn();
const update = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    fichaCompartida: {
      upsert: (...a: unknown[]) => upsert(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
    },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
  },
}));

const getPublishedDevelopment = vi.fn();
const getPublishedUnit = vi.fn();
const getPublishedUnitImages = vi.fn();
vi.mock("@/lib/hub/catalog", () => ({
  getPublishedDevelopment: (...a: unknown[]) => getPublishedDevelopment(...a),
  getPublishedUnit: (...a: unknown[]) => getPublishedUnit(...a),
  getPublishedUnitImages: (...a: unknown[]) => getPublishedUnitImages(...a),
}));

import { cargarFichaPublica, esAperturaDePersona, obtenerOCrearFicha } from "./fichas";

const DEV = {
  id: "dev-uuid",
  slug: "torre-alba",
  name: "Torre Alba",
  developerName: "Grupo Uno",
  developmentType: null,
  stage: "Preventa",
  city: "Tulum",
  state: null,
  zone: null,
  priceMinMxn: 3_000_000,
  priceMaxMxn: null,
  currency: "MXN",
  totalUnits: null,
  availableUnits: null,
  reservedUnits: null,
  soldUnits: null,
  publishedUnits: 1,
  discountedUnitsCount: null,
  coverImage: null,
  estimatedDelivery: null,
  deliveryText: null,
  constructionProgress: null,
  images: ["https://cdn.test/a.webp"],
  amenities: [],
  propertyTypes: [],
  descriptionEs: null,
  descriptionShortEs: null,
  roiProjected: null,
  roiRentalMonthly: null,
  roiAppreciation: null,
  financingDownPayment: null,
  financingMonths: null,
  financingInterest: null,
  address: null,
  neighborhood: null,
  municipality: null,
  lat: null,
  lng: null,
  mapsUrl: null,
  beachDistance: null,
  brochureUrl: null,
  virtualTourUrl: null,
  masterplan: null,
  videoUrl: null,
  commissionRate: 5,
  crmRelationship: null,
  contactName: "Contacto del desarrollador",
  contactPhone: "+529840000000",
};

const UNIDAD = {
  id: "unit-uuid",
  slug: "u-302",
  title: "Depto 302",
  unitNumber: "302",
  unitType: null,
  typology: null,
  status: "Disponible",
  isPresale: false,
  bedrooms: 2,
  bathrooms: 2,
  halfBaths: null,
  areaM2: null,
  builtAreaM2: 90,
  priceMxn: 4_000_000,
  priceUsd: null,
  currency: "MXN",
  discountPriceMxn: null,
  discountPct: null,
  isDiscountActive: false,
  coverImage: "https://cdn.test/u.webp",
  developmentId: "dev-uuid",
  developmentName: "Torre Alba",
  developmentSlug: "torre-alba",
  city: "Tulum",
  zone: null,
  finDirecto: null,
  finHipotecario: null,
  finEnganchePct: null,
  finMesesOpciones: null,
  finTasa: null,
  finEsquemasPago: null,
  finPreventa: null,
};

const ASESORA = {
  name: "Ana López",
  email: "ana@propyte.com",
  phone: null,
  avatarUrl: null,
  isActive: true,
  deletedAt: null,
  profile: { jobTitle: "Asesora", photoUrl: null, phoneDirect: null, whatsappNumber: "9847654321", emailFromAlias: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  getPublishedDevelopment.mockResolvedValue({ data: DEV, error: null });
  getPublishedUnit.mockResolvedValue({ data: UNIDAD, error: null });
  getPublishedUnitImages.mockResolvedValue({ data: ["https://cdn.test/u2.webp"], error: null });
  upsert.mockResolvedValue({ token: "tok-123", aperturas: 0, ultimaApertura: null });
  userFindUnique.mockResolvedValue(ASESORA);
});

describe("obtenerOCrearFicha", () => {
  it("crea la ficha del desarrollo con el id canónico aunque llegue el slug", async () => {
    const r = await obtenerOCrearFicha({ userId: "user-ana", developmentId: "torre-alba" });
    expect(r.ok).toBe(true);
    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ clave: "user-ana:dev-uuid:-" });
    expect(arg.update).toEqual({});
    expect(arg.create).toMatchObject({
      clave: "user-ana:dev-uuid:-",
      tipo: "DESARROLLO",
      hubDevelopmentId: "dev-uuid",
      hubUnitId: null,
      createdById: "user-ana",
    });
    if (r.ok) {
      expect(r.token).toBe("tok-123");
      expect(r.contacto?.nombre).toBe("Ana López");
      expect(r.contacto?.whatsapp).toBe("529847654321");
      expect(r.faltantes).toEqual([]);
    }
  });

  it("la ficha de una unidad guarda la unidad y el desarrollo", async () => {
    const r = await obtenerOCrearFicha({ userId: "user-ana", developmentId: "dev-uuid", unitId: "u-302" });
    expect(r.ok).toBe(true);
    expect(upsert.mock.calls[0][0].create).toMatchObject({
      clave: "user-ana:dev-uuid:unit-uuid",
      tipo: "UNIDAD",
      hubUnitId: "unit-uuid",
    });
    if (r.ok) expect(r.vista.fotos[0]).toBe("https://cdn.test/u.webp");
  });

  it("rechaza una unidad de otro desarrollo", async () => {
    getPublishedUnit.mockResolvedValue({ data: { ...UNIDAD, developmentId: "otro" }, error: null });
    const r = await obtenerOCrearFicha({ userId: "user-ana", developmentId: "dev-uuid", unitId: "unit-uuid" });
    expect(r).toEqual({ ok: false, error: "unidad_de_otro_desarrollo" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("distingue 'no publicado' de 'el catálogo falló'", async () => {
    getPublishedDevelopment.mockResolvedValueOnce({ data: null, error: null });
    expect(await obtenerOCrearFicha({ userId: "u", developmentId: "x" })).toEqual({ ok: false, error: "desarrollo_no_publicado" });

    getPublishedDevelopment.mockResolvedValueOnce({ data: null, error: "No se pudo consultar el catálogo del Hub" });
    expect(await obtenerOCrearFicha({ userId: "u", developmentId: "x" })).toEqual({ ok: false, error: "catalogo" });

    getPublishedUnit.mockResolvedValueOnce({ data: null, error: null });
    expect(await obtenerOCrearFicha({ userId: "u", developmentId: "dev-uuid", unitId: "y" })).toEqual({
      ok: false,
      error: "unidad_no_publicada",
    });
  });

  it("sin la migración aplicada responde un error claro, no un 500", async () => {
    upsert.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    expect(await obtenerOCrearFicha({ userId: "u", developmentId: "dev-uuid" })).toEqual({ ok: false, error: "sin_migracion" });
  });

  it("dos clics simultáneos: el que choca con la clave recupera la fila que ya existe", async () => {
    upsert.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    findUnique.mockResolvedValue({ token: "tok-ya", aperturas: 3, ultimaApertura: null });
    const r = await obtenerOCrearFicha({ userId: "u", developmentId: "dev-uuid" });
    expect(r.ok && r.token).toBe("tok-ya");
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { clave: "u:dev-uuid:-" } }));
  });
});

describe("cargarFichaPublica", () => {
  it("token desconocido → null (404)", async () => {
    findUnique.mockResolvedValue(null);
    expect(await cargarFichaPublica("nada")).toBeNull();
  });

  it("muestra el contacto del asesor que CREÓ el enlace", async () => {
    findUnique.mockResolvedValue({
      id: "f1",
      tipo: "DESARROLLO",
      hubDevelopmentId: "dev-uuid",
      hubUnitId: null,
      createdById: "user-ana",
      createdBy: ASESORA,
    });
    const f = await cargarFichaPublica("tok-123");
    expect(f?.contacto?.nombre).toBe("Ana López");
    expect(f?.vista?.titulo).toBe("Torre Alba");
    expect(JSON.stringify(f)).not.toContain("Contacto del desarrollador");
  });

  it("si la propiedad ya no está publicada, la ficha existe pero sin vista (con el asesor)", async () => {
    findUnique.mockResolvedValue({
      id: "f1",
      tipo: "UNIDAD",
      hubDevelopmentId: "dev-uuid",
      hubUnitId: "unit-uuid",
      createdById: "user-ana",
      createdBy: ASESORA,
    });
    getPublishedUnit.mockResolvedValue({ data: null, error: null });
    const f = await cargarFichaPublica("tok-123");
    expect(f?.vista).toBeNull();
    expect(f?.contacto?.nombre).toBe("Ana López");
  });

  it("si el catálogo falla, LANZA en vez de decir que no existe (#716)", async () => {
    findUnique.mockResolvedValue({
      id: "f1",
      tipo: "DESARROLLO",
      hubDevelopmentId: "dev-uuid",
      hubUnitId: null,
      createdById: "user-ana",
      createdBy: ASESORA,
    });
    getPublishedDevelopment.mockResolvedValue({ data: null, error: "No se pudo consultar el catálogo del Hub" });
    await expect(cargarFichaPublica("tok-123")).rejects.toThrow();
  });

  it("un asesor dado de baja ya no aparece en fichas viejas", async () => {
    findUnique.mockResolvedValue({
      id: "f1",
      tipo: "DESARROLLO",
      hubDevelopmentId: "dev-uuid",
      hubUnitId: null,
      createdById: "user-ana",
      createdBy: { ...ASESORA, isActive: false },
    });
    const f = await cargarFichaPublica("tok-123");
    expect(f?.contacto).toBeNull();
    expect(f?.vista).not.toBeNull();
  });
});

describe("esAperturaDePersona", () => {
  it("no cuenta los robots de vista previa", () => {
    expect(esAperturaDePersona("WhatsApp/2.23.20.0 A")).toBe(false);
    expect(esAperturaDePersona("facebookexternalhit/1.1")).toBe(false);
    expect(esAperturaDePersona("TelegramBot (like TwitterBot)")).toBe(false);
    expect(esAperturaDePersona(null)).toBe(false);
  });

  it("cuenta un navegador de teléfono", () => {
    expect(
      esAperturaDePersona(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      )
    ).toBe(true);
  });
});

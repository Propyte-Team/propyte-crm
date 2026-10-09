import { describe, it, expect } from "vitest";
import { BRAND_CHANNELS, brandCreateSchema, brandPatchSchema } from "./brand";

const UUID = "3f2b8c1e-5d4a-4b6f-9c7e-1a2b3c4d5e6f";
const VALID = { name: "Nativa Tulum", slug: "nativa-tulum" };

describe("brandCreateSchema", () => {
  it("acepta lo mínimo (name + slug) y botEnabled queda en false por defecto", () => {
    const r = brandCreateSchema.safeParse(VALID);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.botEnabled).toBe(false);
  });

  it("acepta una marca completa", () => {
    const r = brandCreateSchema.safeParse({
      ...VALID,
      persona: "Asesora cálida",
      knowledge: "Datos de la marca",
      developmentIds: [UUID],
      defaultPlaza: "TULUM",
      enabledChannels: ["WHATSAPP", "INSTAGRAM"],
      tonePreset: "CALIDO_CERCANO_MX",
      playbookId: UUID,
      marketingOwnerUserId: UUID,
      botEnabled: true,
    });
    expect(r.success).toBe(true);
  });

  it("slug solo admite minúsculas, números y guiones (2-40)", () => {
    for (const slug of ["Nativa", "con espacio", "ñandú", "a", "x".repeat(41), "con_guion_bajo", ""]) {
      expect(brandCreateSchema.safeParse({ ...VALID, slug }).success, `slug "${slug}"`).toBe(false);
    }
    for (const slug of ["ab", "nativa-1", "x".repeat(40), "123"]) {
      expect(brandCreateSchema.safeParse({ ...VALID, slug }).success, `slug "${slug}"`).toBe(true);
    }
  });

  it("name va de 2 a 80 caracteres (con trim)", () => {
    expect(brandCreateSchema.safeParse({ ...VALID, name: "A" }).success).toBe(false);
    expect(brandCreateSchema.safeParse({ ...VALID, name: " A " }).success).toBe(false);
    expect(brandCreateSchema.safeParse({ ...VALID, name: "x".repeat(81) }).success).toBe(false);
    expect(brandCreateSchema.safeParse({ ...VALID, name: "AB" }).success).toBe(true);
    expect(brandCreateSchema.safeParse({ ...VALID, name: "x".repeat(80) }).success).toBe(true);
    const r = brandCreateSchema.safeParse({ ...VALID, name: "  Nativa  " });
    expect(r.success && r.data.name).toBe("Nativa");
  });

  it("enabledChannels es null o un arreglo de canales válidos; SMS es inválido", () => {
    expect([...BRAND_CHANNELS]).toEqual(["WHATSAPP", "INSTAGRAM", "MESSENGER"]);
    expect(brandCreateSchema.safeParse({ ...VALID, enabledChannels: null }).success).toBe(true);
    expect(brandCreateSchema.safeParse({ ...VALID, enabledChannels: [] }).success).toBe(true);
    expect(brandCreateSchema.safeParse({ ...VALID, enabledChannels: ["MESSENGER"] }).success).toBe(true);
    expect(brandCreateSchema.safeParse({ ...VALID, enabledChannels: ["SMS"] }).success).toBe(false);
    expect(brandCreateSchema.safeParse({ ...VALID, enabledChannels: "WHATSAPP" }).success).toBe(false);
  });

  it("developmentIds es un arreglo de uuid con máximo 20", () => {
    expect(brandCreateSchema.safeParse({ ...VALID, developmentIds: [] }).success).toBe(true);
    expect(brandCreateSchema.safeParse({ ...VALID, developmentIds: Array(20).fill(UUID) }).success).toBe(true);
    expect(brandCreateSchema.safeParse({ ...VALID, developmentIds: Array(21).fill(UUID) }).success).toBe(false);
    expect(brandCreateSchema.safeParse({ ...VALID, developmentIds: ["no-es-uuid"] }).success).toBe(false);
  });

  it("defaultPlaza es PDC, TULUM, MERIDA o null", () => {
    for (const p of ["PDC", "TULUM", "MERIDA", null]) {
      expect(brandCreateSchema.safeParse({ ...VALID, defaultPlaza: p }).success, `${p}`).toBe(true);
    }
    expect(brandCreateSchema.safeParse({ ...VALID, defaultPlaza: "CDMX" }).success).toBe(false);
  });

  it("tonePreset es uno de los 4 presets o null", () => {
    for (const t of ["PROFESIONAL_CALIDO", "CALIDO_CERCANO_MX", "EJECUTIVO_SOBRIO", "NEUTRO_DIRECTO", null]) {
      expect(brandCreateSchema.safeParse({ ...VALID, tonePreset: t }).success, `${t}`).toBe(true);
    }
    expect(brandCreateSchema.safeParse({ ...VALID, tonePreset: "SARCASTICO" }).success).toBe(false);
  });

  it("persona admite máximo 2,000 caracteres y knowledge 20,000", () => {
    expect(brandCreateSchema.safeParse({ ...VALID, persona: "x".repeat(2000) }).success).toBe(true);
    expect(brandCreateSchema.safeParse({ ...VALID, persona: "x".repeat(2001) }).success).toBe(false);
    expect(brandCreateSchema.safeParse({ ...VALID, knowledge: "x".repeat(20000) }).success).toBe(true);
    expect(brandCreateSchema.safeParse({ ...VALID, knowledge: "x".repeat(20001) }).success).toBe(false);
    expect(brandCreateSchema.safeParse({ ...VALID, persona: null, knowledge: null }).success).toBe(true);
  });

  it("botEnabled es booleano", () => {
    expect(brandCreateSchema.safeParse({ ...VALID, botEnabled: true }).success).toBe(true);
    expect(brandCreateSchema.safeParse({ ...VALID, botEnabled: "si" }).success).toBe(false);
  });

  it("playbookId y marketingOwnerUserId son uuid o null", () => {
    expect(brandCreateSchema.safeParse({ ...VALID, playbookId: UUID, marketingOwnerUserId: UUID }).success).toBe(true);
    expect(brandCreateSchema.safeParse({ ...VALID, playbookId: null, marketingOwnerUserId: null }).success).toBe(true);
    expect(brandCreateSchema.safeParse({ ...VALID, playbookId: "pb-1" }).success).toBe(false);
    expect(brandCreateSchema.safeParse({ ...VALID, marketingOwnerUserId: "u-1" }).success).toBe(false);
  });

  it("no acepta isDefault ni claves desconocidas (.strict())", () => {
    expect(brandCreateSchema.safeParse({ ...VALID, isDefault: true }).success).toBe(false);
    expect(brandCreateSchema.safeParse({ ...VALID, otraCosa: 1 }).success).toBe(false);
  });

  it("name y slug son obligatorios al crear", () => {
    expect(brandCreateSchema.safeParse({ slug: "ab" }).success).toBe(false);
    expect(brandCreateSchema.safeParse({ name: "Nativa" }).success).toBe(false);
  });
});

describe("brandPatchSchema", () => {
  it("todos los campos son opcionales", () => {
    expect(brandPatchSchema.safeParse({}).success).toBe(true);
    expect(brandPatchSchema.safeParse({ name: "Nuevo nombre" }).success).toBe(true);
  });

  it("sin botEnabled en el cuerpo no se inyecta un default (un PATCH no apaga el agente por accidente)", () => {
    const r = brandPatchSchema.safeParse({ name: "Nuevo nombre" });
    expect(r.success).toBe(true);
    if (r.success) expect("botEnabled" in r.data).toBe(false);
  });

  it("valida igual que el de creación", () => {
    expect(brandPatchSchema.safeParse({ slug: "MAL" }).success).toBe(false);
    expect(brandPatchSchema.safeParse({ enabledChannels: ["SMS"] }).success).toBe(false);
    expect(brandPatchSchema.safeParse({ enabledChannels: null }).success).toBe(true);
  });

  it("no acepta isDefault (.strict())", () => {
    expect(brandPatchSchema.safeParse({ isDefault: true }).success).toBe(false);
    expect(brandPatchSchema.safeParse({ isDefault: false }).success).toBe(false);
  });
});

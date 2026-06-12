import { describe, it, expect } from "vitest";
import {
  conditionsDslSchema,
  actionSpecSchema,
  connectorCredentialsMetaSchema,
  connectorCredentialsTikTokSchema,
  userProfileSchema,
  userTemplateSchema,
  incomingLeadSchema,
} from "./rebuild-f1";

describe("conditions DSL (§D.4)", () => {
  it("acepta DSL anidado válido", () => {
    const r = conditionsDslSchema.safeParse({
      all: [
        { field: "contact.score", op: "gte", value: 70 },
        { field: "contact.preferredLanguage", op: "eq", value: "EN" },
        { any: [{ field: "deal.stage", op: "eq", value: "PROPOSAL_SENT" }] },
      ],
    });
    expect(r.success).toBe(true);
  });
  it("acepta objeto vacío (sin condiciones = siempre true)", () => {
    expect(conditionsDslSchema.safeParse({}).success).toBe(true);
  });
  it("rechaza operador desconocido", () => {
    expect(
      conditionsDslSchema.safeParse({ all: [{ field: "x", op: "regex", value: 1 }] }).success
    ).toBe(false);
  });
  it("rechaza hoja sin field", () => {
    expect(conditionsDslSchema.safeParse({ all: [{ op: "eq", value: 1 }] }).success).toBe(false);
  });
});

describe("action spec", () => {
  it("acepta acción válida", () => {
    expect(
      actionSpecSchema.safeParse({ type: "SEND_WHATSAPP", config: { templateId: "x" } }).success
    ).toBe(true);
  });
  it("rechaza tipo desconocido", () => {
    expect(actionSpecSchema.safeParse({ type: "EXPLODE", config: {} }).success).toBe(false);
  });
});

describe("credenciales conectores", () => {
  it("Meta exige pageId+pageAccessToken+appSecret+verifyToken", () => {
    expect(connectorCredentialsMetaSchema.safeParse({ pageId: "1" }).success).toBe(false);
    expect(
      connectorCredentialsMetaSchema.safeParse({
        pageId: "1",
        pageAccessToken: "t",
        appSecret: "s",
        verifyToken: "v",
      }).success
    ).toBe(true);
  });
  it("TikTok exige advertiserId+accessToken", () => {
    expect(connectorCredentialsTikTokSchema.safeParse({ advertiserId: "1" }).success).toBe(false);
    expect(
      connectorCredentialsTikTokSchema.safeParse({ advertiserId: "1", accessToken: "t" }).success
    ).toBe(true);
  });
});

describe("perfil de usuario (§J)", () => {
  it("cardSlug kebab-case", () => {
    expect(userProfileSchema.safeParse({ cardSlug: "Felipe Luksic" }).success).toBe(false);
    expect(userProfileSchema.safeParse({ cardSlug: "felipe-luksic" }).success).toBe(true);
  });
  it("emailFromAlias debe ser @propyte.com", () => {
    expect(userProfileSchema.safeParse({ emailFromAlias: "x@gmail.com" }).success).toBe(false);
    expect(userProfileSchema.safeParse({ emailFromAlias: "felipe@propyte.com" }).success).toBe(true);
  });
});

describe("plantillas (§J.2)", () => {
  const base = { channel: "WHATSAPP", name: "x", body: "hola {{contact.firstName}}", language: "ES" };
  it("shortcut con formato /algo", () => {
    expect(userTemplateSchema.safeParse({ ...base, shortcut: "precio" }).success).toBe(false);
    expect(userTemplateSchema.safeParse({ ...base, shortcut: "/precio" }).success).toBe(true);
  });
  it("EMAIL puede llevar subject; body obligatorio", () => {
    expect(userTemplateSchema.safeParse({ ...base, channel: "EMAIL", subject: "Hola" }).success).toBe(true);
    expect(userTemplateSchema.safeParse({ ...base, body: "" }).success).toBe(false);
  });
});

describe("incoming lead (webhook §H.5)", () => {
  it("exige teléfono o email", () => {
    expect(
      incomingLeadSchema.safeParse({ source: "WEBSITE", firstName: "A", lastName: "B" }).success
    ).toBe(false);
  });
  it("normaliza el teléfono a E.164", () => {
    const r = incomingLeadSchema.safeParse({
      source: "WEBSITE",
      firstName: "A",
      lastName: "B",
      phone: "+52 984 123 4567",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone).toBe("+529841234567");
  });
  it("acepta solo email sin teléfono", () => {
    expect(
      incomingLeadSchema.safeParse({
        source: "WEBSITE",
        firstName: "A",
        lastName: "B",
        email: "a@b.com",
      }).success
    ).toBe(true);
  });
  it("rechaza teléfono inválido", () => {
    expect(
      incomingLeadSchema.safeParse({
        source: "WEBSITE",
        firstName: "A",
        lastName: "B",
        phone: "123",
      }).success
    ).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  connectorCredentialsGoogleAdsSchema,
  connectorCredentialsLinkedInSchema,
} from "./rebuild-f1";

describe("credenciales Google Ads", () => {
  it("acepta credenciales completas", () => {
    const r = connectorCredentialsGoogleAdsSchema.safeParse({
      customerId: "123-456-7890",
      developerToken: "dev",
      refreshToken: "rt",
      clientId: "cid",
      clientSecret: "cs",
      webhookKey: "k12345678",
    });
    expect(r.success).toBe(true);
  });
  it("rechaza si falta customerId", () => {
    const r = connectorCredentialsGoogleAdsSchema.safeParse({ developerToken: "dev" });
    expect(r.success).toBe(false);
  });
});

describe("credenciales LinkedIn", () => {
  it("acepta credenciales completas", () => {
    const r = connectorCredentialsLinkedInSchema.safeParse({
      adAccountId: "509...",
      accessToken: "at",
    });
    expect(r.success).toBe(true);
  });
  it("rechaza vacío", () => {
    expect(connectorCredentialsLinkedInSchema.safeParse({}).success).toBe(false);
  });
});

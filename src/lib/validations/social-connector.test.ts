import { describe, it, expect } from "vitest";
import { connectorCredentialsSocialSchema, connectorConfigSocialSchema } from "./rebuild-f1";

describe("schemas sociales", () => {
  it("credentials social = token+appSecret, sin pageId (sin verifyToken)", () => {
    expect(connectorCredentialsSocialSchema.safeParse({ pageAccessToken: "T", appSecret: "S" }).success).toBe(true);
    expect(connectorCredentialsSocialSchema.safeParse({ appSecret: "S" }).success).toBe(false);
  });
  it("config social requiere pageId; igBusinessId opcional", () => {
    expect(connectorConfigSocialSchema.safeParse({ pageId: "P", igBusinessId: "IG", brand: "Propyte" }).success).toBe(true);
    expect(connectorConfigSocialSchema.safeParse({ pageId: "P" }).success).toBe(true);
    expect(connectorConfigSocialSchema.safeParse({ igBusinessId: "IG" }).success).toBe(false);
  });
});

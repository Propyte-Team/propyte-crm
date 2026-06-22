import { describe, it, expect } from "vitest";
import { getWhatsAppCredentials } from "./accounts";

const fakeConnector = (config: any, creds: any) => ({
  id: "c1", provider: "WHATSAPP", config,
  __decrypted: creds,
} as any);

describe("getWhatsAppCredentials", () => {
  it("combina phoneNumberId (config) + secretos (credentials)", () => {
    const conn = fakeConnector(
      { phoneNumberId: "111", brand: "Nativa" },
      { accessToken: "tok", verifyToken: "vt", appSecret: "sec" },
    );
    const creds = getWhatsAppCredentials(conn, () => conn.__decrypted);
    expect(creds).toEqual({ phoneNumberId: "111", accessToken: "tok", verifyToken: "vt", appSecret: "sec", brand: "Nativa" });
  });
  it("retorna null si falta phoneNumberId o accessToken", () => {
    expect(getWhatsAppCredentials(fakeConnector({}, { accessToken: "t" }), (c) => (c as any).__decrypted)).toBeNull();
    expect(getWhatsAppCredentials(fakeConnector({ phoneNumberId: "1" }, {}), (c) => (c as any).__decrypted)).toBeNull();
  });
});

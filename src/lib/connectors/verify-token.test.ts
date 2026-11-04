import { describe, it, expect } from "vitest";
import { generarVerifyToken, urlDeWebhook } from "./verify-token";

describe("generarVerifyToken", () => {
  it("32 caracteres hex por defecto y distinto cada vez", () => {
    const a = generarVerifyToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(generarVerifyToken()).not.toBe(a);
  });
  it("respeta el tamaño pedido", () => {
    expect(generarVerifyToken(8)).toHaveLength(16);
  });
});

describe("urlDeWebhook", () => {
  it("une origen y ruta sin dobles barras", () => {
    expect(urlDeWebhook("https://crm.propyte.com/", "/api/connectors/meta/webhook")).toBe(
      "https://crm.propyte.com/api/connectors/meta/webhook",
    );
    expect(urlDeWebhook("http://localhost:3000", "api/x")).toBe("http://localhost:3000/api/x");
  });
});

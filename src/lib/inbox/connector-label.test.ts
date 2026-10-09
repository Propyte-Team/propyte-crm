// Pruebas de la etiqueta de marca de la cuenta en el Inbox (2026-10-09).
import { describe, it, expect } from "vitest";
import { connectorBrandLabel } from "./connector-label";

describe("connectorBrandLabel", () => {
  it("la marca asignada a la cuenta manda sobre config.brand", () => {
    expect(connectorBrandLabel({ config: { brand: "Texto libre" }, brand: { name: "Nativa Tulum" } })).toBe("Nativa Tulum");
  });
  it("sin marca asignada conserva config.brand", () => {
    expect(connectorBrandLabel({ config: { brand: "Texto libre" }, brand: null })).toBe("Texto libre");
    expect(connectorBrandLabel({ config: { brand: "Texto libre" } })).toBe("Texto libre");
  });
  it("sin marca ni config.brand → null", () => {
    expect(connectorBrandLabel({ config: null, brand: null })).toBeNull();
    expect(connectorBrandLabel({ config: {}, brand: undefined })).toBeNull();
  });
  it("config.brand que no es texto se ignora", () => {
    expect(connectorBrandLabel({ config: { brand: 42 }, brand: null })).toBeNull();
  });
});

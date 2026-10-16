import { describe, it, expect } from "vitest";
import { normalizePhoneE164, telefonoLegible, telefonoSinEspacios } from "./phone";

describe("normalizePhoneE164", () => {
  it("normaliza formato mexicano con espacios", () => {
    expect(normalizePhoneE164("+52 984 123 4567")).toBe("+529841234567");
  });
  it("agrega +52 a 10 dígitos nacionales", () => {
    expect(normalizePhoneE164("9841234567")).toBe("+529841234567");
  });
  it("respeta otros códigos de país", () => {
    expect(normalizePhoneE164("+1 (305) 555-0199")).toBe("+13055550199");
  });
  it("quita el 1 de marcación celular legacy 521", () => {
    expect(normalizePhoneE164("+5219841234567")).toBe("+529841234567");
  });
  it("convierte 52 sin + (12 dígitos) a +52", () => {
    expect(normalizePhoneE164("529841234567")).toBe("+529841234567");
  });
  it("tolera el prefijo 'whatsapp:' de Twilio", () => {
    expect(normalizePhoneE164("whatsapp:+5219841234567")).toBe("+529841234567");
  });
  it("tolera guiones y paréntesis", () => {
    expect(normalizePhoneE164("(984) 123-45-67")).toBe("+529841234567");
  });
  it("rechaza basura", () => {
    expect(normalizePhoneE164("hola")).toBeNull();
    expect(normalizePhoneE164("123")).toBeNull();
    expect(normalizePhoneE164("")).toBeNull();
    expect(normalizePhoneE164(null)).toBeNull();
    expect(normalizePhoneE164(undefined)).toBeNull();
  });
  it("rechaza más de 15 dígitos", () => {
    expect(normalizePhoneE164("1234567890123456")).toBeNull();
  });
});

describe("telefonoSinEspacios (#900, Mi perfil)", () => {
  it("no deja entrar espacios, guiones, puntos ni paréntesis", () => {
    expect(telefonoSinEspacios("+52 984 247 0103")).toBe("+529842470103");
    expect(telefonoSinEspacios("(984) 247-01.03")).toBe("9842470103");
    expect(telefonoSinEspacios("+52 ")).toBe("+52");
  });
  it("conserva solo el + del inicio", () => {
    expect(telefonoSinEspacios("52+984")).toBe("52984");
    expect(telefonoSinEspacios("+")).toBe("+");
    expect(telefonoSinEspacios("")).toBe("");
  });
});

describe("telefonoLegible (#898, fichas)", () => {
  it("separa los números de México y de EE. UU./Canadá", () => {
    expect(telefonoLegible("+529842470103")).toBe("+52 984 247 0103");
    expect(telefonoLegible("+15551234567")).toBe("+1 555 123 4567");
  });
  it("cualquier otro formato se muestra tal cual", () => {
    expect(telefonoLegible("+34612345678")).toBe("+34612345678");
    expect(telefonoLegible(null)).toBeNull();
  });
});

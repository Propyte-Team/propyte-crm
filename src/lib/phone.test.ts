import { describe, it, expect } from "vitest";
import { normalizePhoneE164 } from "./phone";

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

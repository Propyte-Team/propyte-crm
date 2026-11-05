import { describe, it, expect } from "vitest";
import { MENSAJE_SIN_TELEFONO, telefonoParaMostrar, tieneTelefono } from "./sin-telefono";

// #833 y #834: un contacto puede existir sin teléfono (solo WhatsApp-usuario, Instagram o
// Messenger); Contact.phone guarda "".
describe("tieneTelefono", () => {
  it("vacío, espacios o null no cuentan como teléfono", () => {
    expect(tieneTelefono("")).toBe(false);
    expect(tieneTelefono("   ")).toBe(false);
    expect(tieneTelefono(null)).toBe(false);
    expect(tieneTelefono(undefined)).toBe(false);
  });
  it("un número sí", () => {
    expect(tieneTelefono("+529841234567")).toBe(true);
  });
});

describe("telefonoParaMostrar (#834: el encabezado del hilo nunca queda en blanco)", () => {
  it("con teléfono, el teléfono", () => {
    expect(telefonoParaMostrar("+529841234567", "WHATSAPP")).toBe("+529841234567");
  });
  it.each([
    ["WHATSAPP", "Sin teléfono · escribe por WhatsApp"],
    ["INSTAGRAM", "Sin teléfono · escribe por Instagram"],
    ["MESSENGER", "Sin teléfono · escribe por Messenger"],
  ])("sin teléfono en un hilo de %s: «%s»", (canal, esperado) => {
    expect(telefonoParaMostrar("", canal)).toBe(esperado);
  });
  it("sin teléfono y sin canal conocido: «Sin teléfono»", () => {
    expect(telefonoParaMostrar("", null)).toBe("Sin teléfono");
    expect(telefonoParaMostrar("", "OTRO")).toBe("Sin teléfono");
  });
  it("nunca devuelve texto vacío", () => {
    for (const canal of ["WHATSAPP", "INSTAGRAM", "MESSENGER", "SMS", "WEB", null, undefined]) {
      expect(telefonoParaMostrar("", canal).length).toBeGreaterThan(0);
    }
  });
});

describe("MENSAJE_SIN_TELEFONO (#833)", () => {
  it("dice qué pasa y qué hacer", () => {
    expect(MENSAJE_SIN_TELEFONO).toMatch(/no tiene teléfono/);
    expect(MENSAJE_SIN_TELEFONO).toMatch(/Agrega su teléfono/);
  });
});

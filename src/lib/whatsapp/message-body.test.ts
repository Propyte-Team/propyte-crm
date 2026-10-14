// Cuerpo legible de un mensaje de WhatsApp (2026-10-14): una sola regla para el entrante, el eco
// de la app y el historial de la coexistencia.
import { describe, it, expect } from "vitest";
import { extractWaBody, waMediaRef } from "./message-body";

describe("extractWaBody", () => {
  it("texto, botones y adjuntos como siempre", () => {
    expect(extractWaBody({ type: "text", text: { body: "hola" } })).toBe("hola");
    expect(extractWaBody({ type: "image", image: { id: "1", caption: "fachada" } })).toBe("[Imagen] fachada");
    expect(extractWaBody({ type: "document", document: { id: "1", filename: "plano.pdf" } })).toBe("[Documento: plano.pdf]");
    expect(extractWaBody({ type: "reaction" })).toBe("[reaction]");
  });
  it("historial: la media llega primero como marcador", () => {
    expect(extractWaBody({ type: "media_placeholder" })).toBe("[Archivo]");
  });
  it("131060 (coexistencia) → se le dice al negocio que lo vea en la app", () => {
    expect(extractWaBody({ type: "unsupported", errors: [{ code: 131060 }] })).toMatch(/app de WhatsApp Business/);
    expect(extractWaBody({ type: "unsupported", errors: [{ code: 1 }] })).toBe("[unsupported]");
  });
  it("waMediaRef solo para tipos con archivo", () => {
    expect(waMediaRef({ type: "audio", audio: { id: "a" } })).toEqual({ id: "a" });
    expect(waMediaRef({ type: "text", text: { body: "x" } })).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { construirCuerpoPrueba, firmarCuerpo, describirRespuesta, describirFalloRed } from "./prueba";

describe("prueba de webhook", () => {
  it("cuerpo marcado como prueba", () => {
    const c = JSON.parse(construirCuerpoPrueba("deal.won", new Date("2026-11-04T10:00:00Z")));
    expect(c).toMatchObject({ event: "deal.won", test: true, timestamp: "2026-11-04T10:00:00.000Z" });
  });
  it("firma HMAC-SHA256 hex", () => {
    expect(firmarCuerpo("x", "k")).toBe(createHmac("sha256", "k").update("x").digest("hex"));
  });
  it("describe códigos HTTP", () => {
    expect(describirRespuesta(200)).toMatchObject({ ok: true, status: 200 });
    expect(describirRespuesta(204).ok).toBe(true);
    expect(describirRespuesta(404).mensaje).toContain("URL");
    expect(describirRespuesta(401).ok).toBe(false);
    expect(describirRespuesta(503).mensaje).toContain("503");
    expect(describirRespuesta(302).ok).toBe(false);
  });
  it("describe fallos de red", () => {
    const t = new Error("x");
    t.name = "TimeoutError";
    expect(describirFalloRed(t).mensaje).toContain("10 segundos");
    expect(describirFalloRed(new Error("ECONNREFUSED")).status).toBeNull();
  });
});

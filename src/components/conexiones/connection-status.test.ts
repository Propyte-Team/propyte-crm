import { describe, it, expect } from "vitest";
import { estadoDeConexion, traducirErrorConexion } from "./connection-status";

const base = { status: "ACTIVE", errorCount: 0, lastError: null, lastLeadAt: null };

describe("estadoDeConexion", () => {
  it("activa con leads y sin errores funciona", () => {
    expect(estadoDeConexion({ ...base, lastLeadAt: "2026-11-01" })).toEqual({ texto: "Funciona", tono: "ok" });
  });
  it("activa sin leads aún queda sin verificar", () => {
    expect(estadoDeConexion(base).texto).toBe("Sin verificar");
  });
  it("con errores muestra el conteo", () => {
    expect(estadoDeConexion({ ...base, errorCount: 3, lastError: "x" }).texto).toBe("Con errores (3)");
    expect(estadoDeConexion({ ...base, status: "ERROR" }).texto).toBe("Con errores (0)");
  });
  it("pausada sin errores", () => {
    expect(estadoDeConexion({ ...base, status: "PAUSED" }).tono).toBe("pausa");
  });
});

describe("traducirErrorConexion", () => {
  it("vacío → null", () => expect(traducirErrorConexion("  ")).toBeNull());
  it.each([
    ["(#190) Error validating access token: Session has expired", "caducó"],
    ["(#200) Requires pages_messaging permission", "permisos"],
    ["Unsupported get request. Object with ID '123' does not exist", "No se encontró"],
    ["Invalid X-Hub-Signature", "firma inválida"],
    ["(#613) Calls to this api have exceeded the rate limit", "limitando"],
  ])("%s", (raw, frag) => {
    const r = traducirErrorConexion(raw)!;
    expect(r.mensaje).toContain(frag);
    expect(r.detalle).toBe(raw);
  });
  it("desconocido conserva el crudo como detalle", () => {
    expect(traducirErrorConexion("boom")).toEqual({ mensaje: "La cuenta reportó un error.", detalle: "boom" });
  });
});

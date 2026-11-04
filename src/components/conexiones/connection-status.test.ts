import { describe, it, expect } from "vitest";
import { estadoDeConexion, traducirErrorConexion, haceCuanto, resumenDeActividad } from "./connection-status";

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

const AHORA = new Date("2026-11-03T12:00:00Z");

describe("haceCuanto", () => {
  it.each([
    [null, null],
    ["2026-11-03T11:59:40Z", "hace un momento"],
    ["2026-11-03T11:30:00Z", "hace 30 min"],
    ["2026-11-03T09:00:00Z", "hace 3 h"],
    ["2026-11-02T10:00:00Z", "hace 1 día"],
    ["2026-10-31T12:00:00Z", "hace 3 días"],
    ["2026-09-01T12:00:00Z", "hace 2 meses"],
    ["basura", null],
  ])("%s → %s", (f, esperado) => expect(haceCuanto(f as string | null, AHORA)).toBe(esperado));
});

describe("resumenDeActividad", () => {
  const c = { ...base, provider: "META", lastLeadAt: "2026-10-31T12:00:00Z", leads30d: 12 };
  it("formulario: estado, último y conteo en 30 días", () => {
    expect(resumenDeActividad(c, AHORA)).toBe("Funciona · último prospecto hace 3 días · 12 en 30 días");
  });
  it("mensajes directos: no muestra conteo (no hay registro confiable)", () => {
    expect(resumenDeActividad({ ...c, provider: "INSTAGRAM", leads30d: 0 }, AHORA)).toBe(
      "Funciona · último prospecto hace 3 días",
    );
  });
  it("con último prospecto pero 0 en 30 días", () => {
    expect(resumenDeActividad({ ...c, leads30d: 0, lastLeadAt: "2026-08-01T12:00:00Z" }, AHORA)).toBe(
      "Funciona · último prospecto hace 3 meses · ninguno en 30 días",
    );
  });
  it("sin nada recibido aún", () => {
    expect(resumenDeActividad({ ...base, provider: "META", leads30d: 0 }, AHORA)).toBe(
      "Sin verificar · aún no recibe prospectos",
    );
  });
  it("con errores y en pausa mantienen el estado", () => {
    expect(resumenDeActividad({ ...c, errorCount: 2, lastError: "x" }, AHORA)).toContain("Con errores (2)");
    expect(resumenDeActividad({ ...c, status: "PAUSED" }, AHORA)).toMatch(/^En pausa · /);
  });
  it("sin dato de conteo se omite", () => {
    expect(resumenDeActividad({ ...c, leads30d: undefined }, AHORA)).toBe("Funciona · último prospecto hace 3 días");
  });
});

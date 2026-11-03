import { describe, it, expect } from "vitest";
import { estadoOcupado, holdPendienteDe, permiteRespaldo } from "./hold-pendiente";

describe("hold pendiente en el Hub (#961)", () => {
  it("solo se aparta de respaldo si el Hub no dijo que no", () => {
    expect(permiteRespaldo({ ok: false, motivo: "sin_configurar" })).toBe(true);
    expect(permiteRespaldo({ ok: false, motivo: "sin_respuesta" })).toBe(true);
    expect(permiteRespaldo({ ok: false, motivo: "mal_configurado" })).toBe(true);
    expect(permiteRespaldo({ ok: false, motivo: "rechazo" })).toBe(false);
    expect(permiteRespaldo({ ok: false })).toBe(false); // sin motivo: se respeta como rechazo
    expect(permiteRespaldo({ ok: true })).toBe(false);
  });

  it("estados del inventario que ya no se apartan (texto libre)", () => {
    for (const s of ["Vendida", "vendido", "Apartada", "RESERVADO"]) expect(estadoOcupado(s)).toBe(true);
    for (const s of ["Disponible", "Preventa", "Entrega inmediata", null, ""]) expect(estadoOcupado(s)).toBe(false);
  });

  it("lee la marca del JSON custom", () => {
    expect(holdPendienteDe(null)).toBeNull();
    expect(holdPendienteDe({ hubUnitSnapshot: {} })).toBeNull();
    expect(holdPendienteDe({ hubHoldPendiente: { desde: "2026-11-03T17:00:00Z", motivo: "sin_configurar", error: "x" } })).toEqual({
      desde: "2026-11-03T17:00:00Z",
      motivo: "sin_configurar",
      error: "x",
    });
  });
});

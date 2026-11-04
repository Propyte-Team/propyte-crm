import { describe, expect, it } from "vitest";
import { abiertaTrasMover, abiertaTrasQuitar, minutosAcumulados, pasoNuevo, primerProblemaDePasos } from "./cadence-editor-model";

describe("cadence-editor-model", () => {
  it("acumula esperas", () => {
    expect(minutosAcumulados([{ delayMinutes: 0 }, { delayMinutes: 1440 }, { delayMinutes: 60 }])).toEqual([0, 1440, 1500]);
  });
  it("paso nuevo es L0 sin espera", () => {
    expect(pasoNuevo("NOTIFY")).toEqual({ actionType: "NOTIFY", delayMinutes: 0, config: {}, autonomyLevel: "L0" });
  });
  it("reporta el primer problema con número de paso", () => {
    const msg = primerProblemaDePasos([pasoNuevo("SEND_WHATSAPP")]);
    expect(msg).toMatch(/^Paso 1: /);
  });
  it("sin pasos no hay problema", () => {
    expect(primerProblemaDePasos([])).toBeNull();
  });
  it("ajusta el paso abierto", () => {
    expect(abiertaTrasMover(1, 1, 2)).toBe(2);
    expect(abiertaTrasMover(2, 1, 2)).toBe(1);
    expect(abiertaTrasMover(0, 1, 2)).toBe(0);
    expect(abiertaTrasQuitar(2, 0)).toBe(1);
    expect(abiertaTrasQuitar(1, 1)).toBeNull();
    expect(abiertaTrasQuitar(null, 1)).toBeNull();
  });
});

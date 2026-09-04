import { describe, it, expect } from "vitest";
import { resolveTargetPlaza } from "./campaign-plaza";

describe("resolveTargetPlaza", () => {
  it("default a PDC cuando no hay señal de Nativa/Tulum/Yaxnah", () => {
    expect(resolveTargetPlaza(["61 CAMPAÑA MEDIO ALTO - [LEADS] - USA"])).toBe("PDC");
  });
  it("PDC con señales vacías, nulas o lista vacía", () => {
    expect(resolveTargetPlaza([null, undefined, ""])).toBe("PDC");
    expect(resolveTargetPlaza([])).toBe("PDC");
  });
  it("TULUM si la campaña menciona Nativa", () => {
    expect(resolveTargetPlaza(["CAMPAÑA NATIVA - LEADS"])).toBe("TULUM");
  });
  it("TULUM si el conector es de Nativa (DM)", () => {
    expect(resolveTargetPlaza([null, null, null, "Messenger | DM Nativa"])).toBe("TULUM");
  });
  it("TULUM si alguna señal menciona Tulum", () => {
    expect(resolveTargetPlaza(["Ads Tulum Beachfront"])).toBe("TULUM");
  });
  it("MERIDA para Yaxnah / Mérida (vivienda popular)", () => {
    expect(resolveTargetPlaza(["Yaxnah Caucel - Leads"])).toBe("MERIDA");
    expect(resolveTargetPlaza(["Campaña Mérida"])).toBe("MERIDA");
  });
  it("MERIDA gana sobre TULUM si ambas señales aparecen", () => {
    expect(resolveTargetPlaza(["Nativa", "Yaxnah"])).toBe("MERIDA");
  });
});

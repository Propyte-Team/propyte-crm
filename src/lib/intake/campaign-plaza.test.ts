import { describe, it, expect } from "vitest";
import { resolveTargetPlaza } from "./campaign-plaza";

describe("resolveTargetPlaza", () => {
  it("default a PDC cuando no hay señal de Nativa/Tulum/Yaxnah", () => {
    expect(resolveTargetPlaza(["61 CAMPAÑA MEDIO ALTO - [LEADS] - USA"])).toBe("PDC");
  });
  // #729: sin UNA SOLA señal no hay nada que medir. El lead se queda sin plaza y cae al
  // Pond, como declara la migración. Es el caso del que escribe por WhatsApp directo:
  // llega sin campaña, sin anuncio y sin conector.
  it("null cuando no llega ni una sola señal (WhatsApp directo)", () => {
    expect(resolveTargetPlaza([null, undefined, ""])).toBeNull();
    expect(resolveTargetPlaza([])).toBeNull();
    expect(resolveTargetPlaza([null, null, null, null, null])).toBeNull();
  });

  it("PDC sigue siendo el default cuando SÍ hay señal y no es Nativa/Yaxnah", () => {
    expect(resolveTargetPlaza(["Campaña Genérica - LEADS"])).toBe("PDC");
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

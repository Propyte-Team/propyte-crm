import { describe, it, expect } from "vitest";
import {
  LIFECYCLE_ORDER, stageIndex, isForward, candidateStageForSignal,
} from "./transitions";

describe("lifecycle transitions (pure)", () => {
  it("orden canónico de 7 etapas", () => {
    expect(LIFECYCLE_ORDER).toEqual([
      "SUSCRIPTOR","LEAD","MQL","SQL","OPORTUNIDAD","CLIENTE","EMBAJADOR",
    ]);
  });

  it("stageIndex: null = -1, primera = 0", () => {
    expect(stageIndex(null)).toBe(-1);
    expect(stageIndex("SUSCRIPTOR")).toBe(0);
    expect(stageIndex("CLIENTE")).toBe(5);
  });

  it("isForward: avanza solo hacia adelante; null→cualquiera es forward", () => {
    expect(isForward(null, "LEAD")).toBe(true);
    expect(isForward("LEAD", "MQL")).toBe(true);
    expect(isForward("MQL", "LEAD")).toBe(false);
    expect(isForward("CLIENTE", "CLIENTE")).toBe(false);
  });

  it("candidateStageForSignal mapea señal→etapa", () => {
    expect(candidateStageForSignal("whatsapp.replied", { score: 0 }, 70)).toBe("MQL");
    expect(candidateStageForSignal("contact.scored", { score: 80 }, 70)).toBe("SQL");
    expect(candidateStageForSignal("contact.scored", { score: 40 }, 70)).toBe("MQL");
    expect(candidateStageForSignal("deal.created", { score: 0 }, 70)).toBe("OPORTUNIDAD");
    expect(candidateStageForSignal("deal.won", { score: 0 }, 70)).toBe("CLIENTE");
    expect(candidateStageForSignal("sla.breach", { score: 0 }, 70)).toBeNull();
  });
});

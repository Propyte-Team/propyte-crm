import { describe, it, expect } from "vitest";
import { evaluateConditions } from "./evaluate-conditions";

// Fase 1: con adAttribution en el contexto del DSL, una regla puede segmentar por
// campaña/red — la base para diferenciar Lead / Broker / Empleo (estilo Zoho).
describe("segmentación por campaña vía adAttribution", () => {
  const broker = {
    contact: { contactType: "LEAD", leadSource: "FACEBOOK_ADS" },
    adAttribution: { campaignName: "13 CAMPAÑA [BROKERS] - MEXICO", network: "FACEBOOK" },
  };
  const lead = {
    contact: { contactType: "LEAD", leadSource: "FACEBOOK_ADS" },
    adAttribution: { campaignName: "77 CAMPAÑA DE FINANCIAMIENTO - [LEADS] [ES] - MEXICO", network: "FACEBOOK" },
  };

  it("regla 'campaña contiene BROKER' matchea broker y NO lead", () => {
    const rule = { all: [{ field: "adAttribution.campaignName", op: "contains", value: "BROKER" }] };
    expect(evaluateConditions(rule as never, broker)).toBe(true);
    expect(evaluateConditions(rule as never, lead)).toBe(false);
  });

  it("regla 'campaña contiene EMPLEO' no matchea ninguno de estos", () => {
    const rule = { all: [{ field: "adAttribution.campaignName", op: "contains", value: "EMPLEO" }] };
    expect(evaluateConditions(rule as never, broker)).toBe(false);
    expect(evaluateConditions(rule as never, lead)).toBe(false);
  });

  it("network eq FACEBOOK", () => {
    const rule = { all: [{ field: "adAttribution.network", op: "eq", value: "FACEBOOK" }] };
    expect(evaluateConditions(rule as never, broker)).toBe(true);
  });
});

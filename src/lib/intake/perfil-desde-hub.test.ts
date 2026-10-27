import { describe, expect, it } from "vitest";
import { cambiosPerfil, respuestasDe, type CandidatoPerfil } from "./perfil-desde-hub";

const AHORA = new Date("2026-10-27T00:00:00Z");

function cand(over: Partial<CandidatoPerfil> = {}): CandidatoPerfil {
  return {
    contactId: "c1",
    metaLeadId: "ml1",
    via: "zoho",
    budget: null,
    urgency: null,
    acquisition: null,
    rawFieldData: [],
    faltaPlazo: true,
    faltaPago: true,
    faltaPerfil: true,
    faltaPresupuesto: true,
    ...over,
  };
}

describe("respuestasDe", () => {
  it("toma el primer valor de cada pregunta y descarta vacíos", () => {
    const r = respuestasDe(
      cand({ rawFieldData: [{ name: "urgencia", values: ["ya"] }, { name: "presupuesto", values: [""] }, { name: "x" }] })
    );
    expect(r).toEqual({ urgencia: "ya" });
  });

  it("las columnas del Hub completan, pero la respuesta cruda gana", () => {
    const r = respuestasDe(cand({ budget: "más_de_$300,000_usd", urgency: "right_now", rawFieldData: [{ name: "urgency", values: ["not_sure"] }] }));
    expect(r).toEqual({ urgency: "not_sure", budget: "más_de_$300,000_usd" });
  });
});

describe("cambiosPerfil", () => {
  it("un lead completo llena los cuatro huecos y deja marca", () => {
    const c = cambiosPerfil(
      cand({
        rawFieldData: [
          { name: "budget_range", values: ["150k_300k"] },
          { name: "urgency", values: ["right_now"] },
          { name: "how_acquire", values: ["cash"] },
          { name: "main_interest", values: ["investment"] },
        ],
      }),
      AHORA
    );
    expect(c).toMatchObject({
      purchaseTimeline: "IMMEDIATE",
      paymentMethod: "CONTADO",
      investmentProfile: "INVESTOR_RENTAL",
      budgetMin: 150_000,
      budgetMax: 300_000,
    });
    expect(c.custom).toEqual({ perfilMetaLeadId: "ml1", perfilMetaVia: "zoho", perfilMetaAt: AHORA.toISOString(), budget_currency: "USD" });
    expect(c.llenados).toEqual(["purchaseTimeline", "paymentMethod", "investmentProfile", "presupuesto"]);
  });

  it("NUNCA pisa lo que ya tiene el contacto", () => {
    const c = cambiosPerfil(
      cand({
        faltaPlazo: false,
        faltaPresupuesto: false,
        rawFieldData: [
          { name: "urgencia", values: ["ya"] },
          { name: "presupuesto", values: ["mas_6"] },
          { name: "forma_adquisicion", values: ["contado"] },
        ],
      }),
      AHORA
    );
    expect(c.purchaseTimeline).toBeNull();
    expect(c.budgetMin).toBeNull();
    expect(c.custom.budget_currency).toBeUndefined();
    expect(c.paymentMethod).toBe("CONTADO");
    expect(c.llenados).toEqual(["paymentMethod"]);
  });

  it("respuestas indecisas o de prueba no inventan nada, pero sí dejan marca", () => {
    const c = cambiosPerfil(
      cand({
        rawFieldData: [
          { name: "urgencia", values: ["sin_decidir"] },
          { name: "forma_adquisicion", values: ["no_claro"] },
          { name: "presupuesto", values: ["<test lead: dummy data for presupuesto>"] },
        ],
      }),
      AHORA
    );
    expect(c.llenados).toEqual([]);
    expect(c.custom.perfilMetaLeadId).toBe("ml1");
  });
});

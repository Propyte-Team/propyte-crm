import { describe, it, expect } from "vitest";
import { resolveLeadSourceCategory, dealCommissionFields } from "./for-deal";

// Auditoría 2026-09-03 #D-01. Antes de este arreglo, las dos rutas de cierre calculaban
// con 40/10/5/5 escrito a mano sobre la tasa del desarrollo, y el motor de comisiones
// —con tasas por tipo de operación, reparto al broker y redondeo— no tenía llamadores.

describe("resolveLeadSourceCategory", () => {
  it("un negocio con broker externo asignado es BROKER_LEAD, gane quien gane la fuente", () => {
    // El broker está registrado en el negocio: hay que pagarle, diga lo que diga el
    // campo de fuente (que suele venir de la campaña, no de quién trajo al cliente).
    expect(
      resolveLeadSourceCategory({ leadSourceAtDeal: "META_ADS", externalBrokerId: "brk-1" })
    ).toBe("BROKER_LEAD");
  });

  it("clasifica por fuente cuando no hay broker asignado", () => {
    expect(resolveLeadSourceCategory({ leadSourceAtDeal: "REFERIDO_BROKER" })).toBe("BROKER_LEAD");
    expect(resolveLeadSourceCategory({ leadSourceAtDeal: "REGISTRO_BROKER" })).toBe("BROKER_LEAD");
    expect(resolveLeadSourceCategory({ leadSourceAtDeal: "SELF_GEN" })).toBe("ASESOR_LEAD");
    expect(resolveLeadSourceCategory({ leadSourceAtDeal: "LLAMADA_FRIA" })).toBe("ASESOR_LEAD");
    expect(resolveLeadSourceCategory({ leadSourceAtDeal: "BASE_DE_DATOS" })).toBe("ASESOR_LEAD");
    expect(resolveLeadSourceCategory({ leadSourceAtDeal: "WALK_IN" })).toBe("PROPYTE_LEAD");
    expect(resolveLeadSourceCategory({ leadSourceAtDeal: "FACEBOOK_ADS" })).toBe("PROPYTE_LEAD");
  });

  it("un cliente que refiere es lead de la casa, no de broker", () => {
    // REFERIDO_CLIENTE es el caso que más fácil se clasifica mal: quien refiere ya es
    // cliente de Propyte, así que el lead no le pertenece a ningún broker.
    expect(resolveLeadSourceCategory({ leadSourceAtDeal: "REFERIDO_CLIENTE" })).toBe("PROPYTE_LEAD");
  });

  it("ante fuente vacía, desconocida o con otro formato, cae en PROPYTE_LEAD", () => {
    expect(resolveLeadSourceCategory({})).toBe("PROPYTE_LEAD");
    expect(resolveLeadSourceCategory({ leadSourceAtDeal: "" })).toBe("PROPYTE_LEAD");
    expect(resolveLeadSourceCategory({ leadSourceAtDeal: "OTRO" })).toBe("PROPYTE_LEAD");
    expect(resolveLeadSourceCategory({ leadSourceAtDeal: "  self_gen  " })).toBe("ASESOR_LEAD");
  });
});

describe("dealCommissionFields", () => {
  it("paga al broker externo, que antes cobraba 0 porque nadie escribía el campo", () => {
    // Corretaje 6% sobre 2,000,000 = 120,000. Reparto BROKER_LEAD: asesor 20%, TL 5%,
    // gerente 5%, director 5%, broker 25%.
    const fields = dealCommissionFields({
      estimatedValue: 2_000_000,
      dealType: "CORRETAJE",
      externalBrokerId: "brk-1",
    });

    expect(fields).toEqual({
      commissionTotal: 120_000,
      commissionAdvisor: 24_000,
      commissionTL: 6_000,
      commissionGerente: 6_000,
      commissionDirector: 6_000,
      commissionBrokerExt: 30_000,
    });
  });

  it("calcula aunque el negocio no pertenezca a ningún desarrollo", () => {
    // Este era el hueco silencioso: sin developmentId no se calculaba NADA,
    // `commissionTotal` quedaba en null y el KPI de comisiones lo contaba como cero.
    const fields = dealCommissionFields({
      estimatedValue: 1_000_000,
      dealType: "NATIVA_CONTADO",
      leadSourceAtDeal: "WALK_IN",
      developmentCommissionRate: null,
    });

    // 13.03% de 1,000,000 = 130,300. PROPYTE_LEAD: asesor 30%, resto 5% cada uno.
    expect(fields.commissionTotal).toBe(130_300);
    expect(fields.commissionAdvisor).toBe(39_090);
    expect(fields.commissionTL).toBe(6_515);
    expect(fields.commissionGerente).toBe(6_515);
    expect(fields.commissionDirector).toBe(6_515);
    expect(fields.commissionBrokerExt).toBe(0);
  });

  it("la tasa negociada del desarrollo manda sobre la tabla por tipo de operación", () => {
    // Es el número que se firmó con el desarrollador: gana sobre el 6% genérico
    // de corretaje.
    const fields = dealCommissionFields({
      estimatedValue: 1_000_000,
      dealType: "CORRETAJE",
      leadSourceAtDeal: "WALK_IN",
      developmentCommissionRate: 9,
    });

    expect(fields.commissionTotal).toBe(90_000);
  });

  it("una tasa de desarrollo nula o cero no anula la comisión: cae en la tabla", () => {
    const conCero = dealCommissionFields({
      estimatedValue: 1_000_000,
      dealType: "MACROLOTE",
      developmentCommissionRate: 0,
    });
    expect(conCero.commissionTotal).toBe(90_000); // 9% de MACROLOTE
  });

  it("reparte prospección propia del asesor al 40%", () => {
    const fields = dealCommissionFields({
      estimatedValue: 1_000_000,
      dealType: "MACROLOTE",
      leadSourceAtDeal: "SELF_GEN",
    });

    expect(fields.commissionTotal).toBe(90_000);
    expect(fields.commissionAdvisor).toBe(36_000);
  });

  it("redondea cada monto a dos decimales", () => {
    // Antes no había redondeo: los montos entraban a un Decimal(14,2) con más
    // decimales de los que la columna guarda.
    const fields = dealCommissionFields({
      estimatedValue: 333_333,
      dealType: "CORRETAJE",
      leadSourceAtDeal: "WALK_IN",
    });

    expect(fields.commissionTotal).toBe(19_999.98);
    expect(fields.commissionAdvisor).toBe(5_999.99); // 19,999.98 × 30% = 5,999.994
    for (const amount of Object.values(fields)) {
      expect(Number(amount.toFixed(2))).toBe(amount);
    }
  });

  it("nunca reparte más de la comisión total", () => {
    for (const dealType of ["NATIVA_CONTADO", "CORRETAJE", "MASTERBROKER"] as const) {
      for (const source of ["WALK_IN", "SELF_GEN", "REFERIDO_BROKER"]) {
        const f = dealCommissionFields({
          estimatedValue: 1_234_567,
          dealType,
          leadSourceAtDeal: source,
        });
        const repartido =
          f.commissionAdvisor +
          f.commissionTL +
          f.commissionGerente +
          f.commissionDirector +
          f.commissionBrokerExt;
        expect(repartido).toBeLessThanOrEqual(f.commissionTotal + 0.01);
      }
    }
  });
});

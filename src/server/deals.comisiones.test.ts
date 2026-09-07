import { describe, it, expect, vi, beforeEach } from "vitest";

// Auditoría 2026-09-03 #D-01 — el cierre de negocio calculaba las comisiones con
// porcentajes escritos a mano. Estas pruebas fallan con el código anterior:
//  · la primera, porque `commissionBrokerExt` nunca se escribía (broker cobrando 0);
//  · la segunda, porque sin `developmentId` no se calculaba ninguna comisión.

const dealFindUnique = vi.fn();
const dealUpdate = vi.fn();
const developmentFindUnique = vi.fn();
const activityCreate = vi.fn();
const contactUpdate = vi.fn();
const contactFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    deal: { findUnique: (...a: unknown[]) => dealFindUnique(...a) },
    development: { findUnique: (...a: unknown[]) => developmentFindUnique(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    contact: {
      update: (...a: unknown[]) => contactUpdate(...a),
      findUnique: (...a: unknown[]) => contactFindUnique(...a),
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "user-1", role: "ADMIN", plaza: "PDC" } }),
}));

vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_o: unknown, fn: (tx: unknown) => unknown) =>
    fn({ deal: { update: (...a: unknown[]) => dealUpdate(...a) } }),
}));

vi.mock("@/lib/webhooks/dispatcher", () => ({ dispatchWebhook: async () => undefined }));
vi.mock("@/lib/workflows/events", () => ({ emitEvent: async () => undefined }));
vi.mock("@/lib/capi/events", () => ({ recordStageConversion: async () => undefined }));

import { transitionDealStage } from "./deals";

const DEAL_ID = "11111111-1111-4111-8111-111111111111";

const contactoCompleto = {
  id: "contact-1",
  investmentProfile: "PATRIMONIAL",
  propertyType: "DEPARTAMENTO",
  budgetMin: 1_000_000,
  purchaseTimeline: "TRES_MESES",
};

beforeEach(() => {
  dealFindUnique.mockReset();
  dealUpdate.mockReset();
  dealUpdate.mockResolvedValue({
    id: DEAL_ID,
    unitId: null,
    developmentId: null,
    contactId: "contact-1",
  });
  developmentFindUnique.mockReset();
  activityCreate.mockReset().mockResolvedValue({});
  contactUpdate.mockReset().mockResolvedValue({});
  contactFindUnique.mockReset().mockResolvedValue(null);
});

/** Los seis campos de comisión tal como quedaron en el update del deal. */
async function comisionesAlCerrar(deal: Record<string, unknown>) {
  dealFindUnique.mockResolvedValue({
    id: DEAL_ID,
    stage: "CLOSING",
    contactId: "contact-1",
    contact: contactoCompleto,
    unitId: null,
    developmentId: null,
    externalBrokerId: null,
    leadSourceAtDeal: "META_ADS",
    ...deal,
  });

  await transitionDealStage(DEAL_ID, "WON", { actualCloseDate: "2026-09-07" });

  return dealUpdate.mock.calls[0][0].data;
}

describe("transitionDealStage → WON: comisiones", () => {
  it("le paga al broker externo del negocio", async () => {
    const data = await comisionesAlCerrar({
      estimatedValue: 2_000_000,
      dealType: "CORRETAJE",
      externalBrokerId: "brk-1",
    });

    // Corretaje 6% de 2,000,000 = 120,000, reparto de lead de broker.
    expect(data.commissionTotal).toBe(120_000);
    expect(data.commissionBrokerExt).toBe(30_000);
    expect(data.commissionAdvisor).toBe(24_000);
  });

  it("calcula comisión aunque el negocio no cuelgue de ningún desarrollo", async () => {
    const data = await comisionesAlCerrar({
      estimatedValue: 1_000_000,
      dealType: "NATIVA_CONTADO",
      developmentId: null,
    });

    expect(data.commissionTotal).toBe(130_300);
    expect(data.commissionAdvisor).toBe(39_090);
    expect(developmentFindUnique).not.toHaveBeenCalled();
  });

  it("usa la tasa negociada del desarrollo cuando el negocio pertenece a uno", async () => {
    developmentFindUnique.mockResolvedValue({ commissionRate: 9 });

    const data = await comisionesAlCerrar({
      estimatedValue: 1_000_000,
      dealType: "CORRETAJE",
      developmentId: "dev-1",
    });

    // 9% del contrato con el desarrollador, no el 6% genérico de corretaje.
    expect(data.commissionTotal).toBe(90_000);
    expect(developmentFindUnique).toHaveBeenCalled();
  });

  it("no toca los campos de comisión en una etapa que no es WON", async () => {
    dealFindUnique.mockResolvedValue({
      id: DEAL_ID,
      stage: "NEGOTIATION",
      contactId: "contact-1",
      contact: contactoCompleto,
      unitId: null,
      developmentId: "dev-1",
      externalBrokerId: null,
      leadSourceAtDeal: "META_ADS",
      estimatedValue: 1_000_000,
      dealType: "CORRETAJE",
    });

    await transitionDealStage(DEAL_ID, "CLOSING", {});

    expect(dealUpdate.mock.calls[0][0].data.commissionTotal).toBeUndefined();
  });
});

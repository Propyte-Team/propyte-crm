import { describe, it, expect, vi, beforeEach } from "vitest";

// Auditoría 2026-09-03 #D-02, la ruta que usa la UI del pipeline.
// Aquí vivía la peor forma del bug: la condición era `data.stage === "RESERVED"` a secas,
// sin comparar con la etapa anterior, así que un doble clic —o un reintento del
// navegador— volvía a mover los contadores del desarrollo.

const session = { user: { id: "u1", role: "ADMIN", plaza: "PDC" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const dealFindUnique = vi.fn();
// Escrituras con el cliente global: si alguna se llama, no están en la transacción.
const unitUpdateGlobal = vi.fn();
const developmentUpdateGlobal = vi.fn();
const activityCreateGlobal = vi.fn();

const txDealUpdate = vi.fn();
const txUnitFindUnique = vi.fn();
const txUnitUpdate = vi.fn();
const txDevelopmentUpdate = vi.fn();
const txActivityCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    deal: {
      findUnique: (...a: unknown[]) => dealFindUnique(...a),
      update: vi.fn(async () => ({})),
    },
    unit: { update: (...a: unknown[]) => unitUpdateGlobal(...a), findUnique: vi.fn(async () => null) },
    development: {
      update: (...a: unknown[]) => developmentUpdateGlobal(...a),
      findUnique: vi.fn(async () => null),
    },
    activity: { create: (...a: unknown[]) => activityCreateGlobal(...a) },
  },
}));

vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_o: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      deal: { update: (...a: unknown[]) => txDealUpdate(...a) },
      unit: {
        findUnique: (...a: unknown[]) => txUnitFindUnique(...a),
        update: (...a: unknown[]) => txUnitUpdate(...a),
      },
      development: { update: (...a: unknown[]) => txDevelopmentUpdate(...a) },
      activity: { create: (...a: unknown[]) => txActivityCreate(...a) },
    }),
}));

import { PATCH } from "./route";

const DEAL_ID = "44444444-4444-4444-4444-444444444444";
const UNIT_ID = "55555555-5555-4555-8555-555555555555";

function req(body: unknown) {
  return new Request(`http://localhost/api/deals/${DEAL_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

const params = { params: { id: DEAL_ID } };

function dealEnEtapa(stage: string, extra: Record<string, unknown> = {}) {
  dealFindUnique.mockResolvedValue({
    id: DEAL_ID,
    stage,
    contactId: "contact-1",
    assignedToId: "u1",
    unitId: UNIT_ID,
    developmentId: "dev-1",
    hubUnitId: null,
    externalBrokerId: null,
    leadSourceAtDeal: "META_ADS",
    estimatedValue: 1_000_000,
    dealType: "NATIVA_CONTADO",
    contact: {
      id: "contact-1",
      investmentProfile: "PATRIMONIAL",
      propertyType: "DEPARTAMENTO",
      budgetMin: 1_000_000,
      purchaseTimeline: "TRES_MESES",
    },
    assignedTo: { id: "u1", plaza: "PDC", teamLeaderId: null },
    development: { id: "dev-1", name: "Nativa", commissionRate: 13.03 },
    unit: { id: UNIT_ID, unitNumber: "A-101", status: "DISPONIBLE" },
    activities: [],
    ...extra,
  });
}

beforeEach(() => {
  for (const m of [
    dealFindUnique, unitUpdateGlobal, developmentUpdateGlobal, activityCreateGlobal,
    txDealUpdate, txUnitFindUnique, txUnitUpdate, txDevelopmentUpdate, txActivityCreate,
  ]) m.mockReset();

  txDealUpdate.mockResolvedValue({
    id: DEAL_ID, unitId: UNIT_ID, developmentId: "dev-1", estimatedValue: 1_000_000,
  });
  txUnitUpdate.mockResolvedValue({});
  txDevelopmentUpdate.mockResolvedValue({});
  txActivityCreate.mockResolvedValue({});
});

describe("PATCH /api/deals/[id] — integridad del cierre (#D-02)", () => {
  it("el doble clic sobre un negocio YA reservado no vuelve a mover el inventario", async () => {
    // Este es el bug de la ruta: la condición no comparaba con la etapa anterior.
    dealEnEtapa("RESERVED");

    const res = await PATCH(req({ stage: "RESERVED", unitId: UNIT_ID }), params);

    expect(res.status).toBe(200);
    expect(txUnitUpdate).not.toHaveBeenCalled();
    expect(txDevelopmentUpdate).not.toHaveBeenCalled();
    // Tampoco se duplica la nota de cronología.
    expect(txActivityCreate).not.toHaveBeenCalled();
  });

  it("escribe deal, unidad, contadores y nota dentro de la misma transacción", async () => {
    dealEnEtapa("NEGOTIATION");
    txUnitFindUnique.mockResolvedValue({ status: "DISPONIBLE" });

    const res = await PATCH(req({ stage: "RESERVED", unitId: UNIT_ID }), params);

    expect(res.status).toBe(200);
    expect(txDealUpdate).toHaveBeenCalledOnce();
    expect(txUnitUpdate).toHaveBeenCalledOnce();
    expect(txActivityCreate).toHaveBeenCalledOnce();
    expect(txDevelopmentUpdate.mock.calls[0][0].data).toEqual({
      reservedUnits: { increment: 1 },
      availableUnits: { decrement: 1 },
    });
    // Nada con el cliente global.
    expect(unitUpdateGlobal).not.toHaveBeenCalled();
    expect(developmentUpdateGlobal).not.toHaveBeenCalled();
    expect(activityCreateGlobal).not.toHaveBeenCalled();
  });

  it("ganar una unidad que nunca se apartó no deja el contador de apartadas negativo", async () => {
    dealEnEtapa("CLOSING");
    txUnitFindUnique.mockResolvedValue({ status: "DISPONIBLE" });

    const res = await PATCH(
      req({ stage: "WON", actualCloseDate: "2026-09-07" }),
      params
    );

    expect(res.status).toBe(200);
    expect(txDevelopmentUpdate.mock.calls[0][0].data).toEqual({
      soldUnits: { increment: 1 },
      availableUnits: { decrement: 1 },
    });
  });

  it("un cambio que no es de etapa no toca inventario ni deja nota", async () => {
    dealEnEtapa("NEGOTIATION");

    const res = await PATCH(req({ probability: 55 }), params);

    expect(res.status).toBe(200);
    expect(txDealUpdate).toHaveBeenCalledOnce();
    expect(txUnitUpdate).not.toHaveBeenCalled();
    expect(txActivityCreate).not.toHaveBeenCalled();
  });
});

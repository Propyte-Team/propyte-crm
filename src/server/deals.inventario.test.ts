import { describe, it, expect, vi, beforeEach } from "vitest";

// Auditoría 2026-09-03 #D-02, la mitad que las pruebas puras no cubren: que el cambio de
// etapa escriba TODO dentro de la transacción y que el movimiento de inventario dependa
// del estado real de la unidad. Contra el código anterior fallan casi todas: ahí la
// unidad, los contadores y la nota se escribían con el cliente global, después de que la
// transacción del deal ya había cerrado.

const dealFindUnique = vi.fn();
const activityCreate = vi.fn();
const contactUpdate = vi.fn();
const contactFindUnique = vi.fn();
// Escrituras FUERA de la transacción: si alguna se llama, el arreglo no está puesto.
const unitUpdateGlobal = vi.fn();
const developmentUpdateGlobal = vi.fn();

// Escrituras DENTRO de la transacción.
const txDealUpdate = vi.fn();
const txUnitFindUnique = vi.fn();
const txUnitUpdate = vi.fn();
const txDevelopmentUpdate = vi.fn();
const txActivityCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    deal: { findUnique: (...a: unknown[]) => dealFindUnique(...a) },
    development: {
      findUnique: vi.fn(async () => null),
      update: (...a: unknown[]) => developmentUpdateGlobal(...a),
    },
    unit: {
      findUnique: vi.fn(async () => null),
      update: (...a: unknown[]) => unitUpdateGlobal(...a),
    },
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

vi.mock("@/lib/webhooks/dispatcher", () => ({ dispatchWebhook: async () => undefined }));
vi.mock("@/lib/workflows/events", () => ({ emitEvent: async () => undefined }));
vi.mock("@/lib/capi/events", () => ({ recordStageConversion: async () => undefined }));

import { transitionDealStage } from "./deals";

const DEAL_ID = "22222222-2222-4222-8222-222222222222";
const UNIT_ID = "33333333-3333-4333-8333-333333333333";

const contactoCompleto = {
  id: "contact-1",
  investmentProfile: "PATRIMONIAL",
  propertyType: "DEPARTAMENTO",
  budgetMin: 1_000_000,
  purchaseTimeline: "TRES_MESES",
};

beforeEach(() => {
  for (const m of [
    dealFindUnique, activityCreate, contactUpdate, contactFindUnique,
    unitUpdateGlobal, developmentUpdateGlobal,
    txDealUpdate, txUnitFindUnique, txUnitUpdate, txDevelopmentUpdate, txActivityCreate,
  ]) m.mockReset();

  contactFindUnique.mockResolvedValue(null);
  contactUpdate.mockResolvedValue({});
  txDealUpdate.mockResolvedValue({
    id: DEAL_ID, unitId: UNIT_ID, developmentId: "dev-1", contactId: "contact-1",
    estimatedValue: 1_000_000,
  });
  txUnitUpdate.mockResolvedValue({});
  txDevelopmentUpdate.mockResolvedValue({});
  txActivityCreate.mockResolvedValue({});
});

function dealEnEtapa(stage: string) {
  dealFindUnique.mockResolvedValue({
    id: DEAL_ID,
    stage,
    contactId: "contact-1",
    contact: contactoCompleto,
    unitId: UNIT_ID,
    developmentId: "dev-1",
    assignedToId: "user-9",
    externalBrokerId: null,
    leadSourceAtDeal: "META_ADS",
    estimatedValue: 1_000_000,
    dealType: "NATIVA_CONTADO",
  });
}

/** Los contadores que se mandaron a mover, o null si no se movió ninguno. */
function contadores(): Record<string, unknown> | null {
  if (txDevelopmentUpdate.mock.calls.length === 0) return null;
  return txDevelopmentUpdate.mock.calls[0][0].data;
}

describe("transitionDealStage — todo en una transacción (#D-02)", () => {
  it("no escribe unidad, contadores ni nota con el cliente global", async () => {
    dealEnEtapa("NEGOTIATION");
    txUnitFindUnique.mockResolvedValue({ status: "DISPONIBLE" });

    await transitionDealStage(DEAL_ID, "RESERVED", { unitId: UNIT_ID });

    // Lo que importa: las cuatro escrituras pasaron por el tx, no por prisma global.
    expect(unitUpdateGlobal).not.toHaveBeenCalled();
    expect(developmentUpdateGlobal).not.toHaveBeenCalled();
    expect(activityCreate).not.toHaveBeenCalled();
    expect(txDealUpdate).toHaveBeenCalledOnce();
    expect(txUnitUpdate).toHaveBeenCalledOnce();
    expect(txDevelopmentUpdate).toHaveBeenCalledOnce();
    expect(txActivityCreate).toHaveBeenCalledOnce();
  });

  it("si la unidad falla, el error sube y nada queda confirmado a medias", async () => {
    dealEnEtapa("NEGOTIATION");
    txUnitFindUnique.mockResolvedValue({ status: "DISPONIBLE" });
    txUnitUpdate.mockRejectedValue(new Error("timeout del pooler"));

    await expect(
      transitionDealStage(DEAL_ID, "RESERVED", { unitId: UNIT_ID })
    ).rejects.toThrow("timeout del pooler");

    // La nota nunca se llegó a crear: va después de la unidad, en la misma transacción.
    expect(txActivityCreate).not.toHaveBeenCalled();
  });
});

describe("transitionDealStage — contadores de inventario (#D-02)", () => {
  it("apartar una unidad disponible mueve disponible → apartada", async () => {
    dealEnEtapa("NEGOTIATION");
    txUnitFindUnique.mockResolvedValue({ status: "DISPONIBLE" });

    await transitionDealStage(DEAL_ID, "RESERVED", { unitId: UNIT_ID });

    expect(contadores()).toEqual({
      reservedUnits: { increment: 1 },
      availableUnits: { decrement: 1 },
    });
  });

  it("apartar una unidad YA apartada no vuelve a contar", async () => {
    dealEnEtapa("NEGOTIATION");
    txUnitFindUnique.mockResolvedValue({ status: "APARTADA" });

    await transitionDealStage(DEAL_ID, "RESERVED", { unitId: UNIT_ID });

    expect(contadores()).toBeNull();
  });

  it("ganar desde apartada descuenta de apartadas", async () => {
    dealEnEtapa("RESERVED");
    txUnitFindUnique.mockResolvedValue({ status: "APARTADA" });

    await transitionDealStage(DEAL_ID, "WON", { actualCloseDate: "2026-09-07" });

    expect(contadores()).toEqual({
      soldUnits: { increment: 1 },
      reservedUnits: { decrement: 1 },
    });
  });

  it("ganar sin haber apartado descuenta de disponibles, no de apartadas", async () => {
    // Salto de etapa CONTRACT_SIGNED → WON sobre una unidad que nunca se apartó. Antes
    // esto hacía `reservedUnits - 1` y el contador quedaba negativo para siempre.
    dealEnEtapa("CONTRACT_SIGNED");
    txUnitFindUnique.mockResolvedValue({ status: "DISPONIBLE" });

    await transitionDealStage(DEAL_ID, "WON", { actualCloseDate: "2026-09-07" });

    const data = contadores()!;
    expect(data).toEqual({
      soldUnits: { increment: 1 },
      availableUnits: { decrement: 1 },
    });
    expect(data.reservedUnits).toBeUndefined();
  });

  it("una etapa sin inventario no toca la unidad ni los contadores", async () => {
    dealEnEtapa("NEGOTIATION");

    await transitionDealStage(DEAL_ID, "CLOSING", {});

    expect(txUnitUpdate).not.toHaveBeenCalled();
    expect(txDevelopmentUpdate).not.toHaveBeenCalled();
    expect(txActivityCreate).toHaveBeenCalledOnce();
  });
});

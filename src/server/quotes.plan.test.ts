import { describe, it, expect, vi, beforeEach } from "vitest";

// Auditoría 2026-09-03 #D-03, la mitad que las pruebas puras no cubren: que
// `createPaymentPlan` de verdad guarde las parcialidades en centavos cerrados.
// `pricing.test.ts` prueba la aritmética; esto prueba que la aritmética se use.
// Falla con el código anterior, que prorrateaba en punto flotante.

const quoteFindFirst = vi.fn();
const paymentPlanCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    quote: { findFirst: (...a: unknown[]) => quoteFindFirst(...a) },
    paymentPlan: { create: (...a: unknown[]) => paymentPlanCreate(...a) },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "user-1", role: "ADMIN" } }),
}));

import { createPaymentPlan } from "./quotes";

/** Las parcialidades tal como se mandaron a crear, en orden. */
function parcialidadesCreadas(): number[] {
  const data = paymentPlanCreate.mock.calls[0][0].data;
  return data.schedules.create.map((s: { amount: number }) => s.amount);
}

beforeEach(() => {
  quoteFindFirst.mockReset();
  paymentPlanCreate.mockReset().mockResolvedValue({
    id: "plan-1",
    quoteId: "quote-1",
    downPaymentPct: 0,
    downPaymentAmount: 0,
    monthsCount: 0,
    monthlyAmount: 0,
    deliveryPaymentPct: 0,
    deliveryAmount: 0,
    schedules: [],
  });
});

function conCotizacionDe(finalPrice: number) {
  quoteFindFirst.mockResolvedValue({
    id: "quote-1",
    finalPrice,
    deletedAt: null,
    paymentPlan: null,
  });
}

describe("createPaymentPlan — las parcialidades cierran contra el precio final", () => {
  it("el caso que no cerraba: 1,000,000 con 10% de enganche y 7 mensualidades", async () => {
    // 900,000 / 7 = 128,571.428571… Antes se guardaba 128,571.43 siete veces
    // = 900,000.01, y el estado de cuenta del cliente nunca cuadraba.
    conCotizacionDe(1_000_000);

    await createPaymentPlan("quote-1", { downPaymentPct: 10, monthsCount: 7 });

    const parcialidades = parcialidadesCreadas();
    const suma = parcialidades.reduce((a, b) => a + b, 0);

    expect(Number(suma.toFixed(2))).toBe(1_000_000);
    expect(parcialidades).toHaveLength(8); // enganche + 7 mensualidades
    // El residuo se carga en la última, no se reparte ni se pierde.
    expect(parcialidades[7]).not.toBe(parcialidades[6]);
  });

  it("cierra también con pago contra entrega y plazos largos", async () => {
    conCotizacionDe(3_333_333.33);

    await createPaymentPlan("quote-1", {
      downPaymentPct: 15,
      monthsCount: 48,
      deliveryPaymentPct: 25,
    });

    const parcialidades = parcialidadesCreadas();
    const suma = parcialidades.reduce((a, b) => a + b, 0);

    expect(Number(suma.toFixed(2))).toBe(3_333_333.33);
    expect(parcialidades).toHaveLength(50); // enganche + 48 + entrega
  });

  it("ninguna parcialidad trae más de dos decimales", async () => {
    conCotizacionDe(999_999.99);

    await createPaymentPlan("quote-1", { downPaymentPct: 33, monthsCount: 11 });

    for (const monto of parcialidadesCreadas()) {
      expect(Number(monto.toFixed(2))).toBe(monto);
    }
  });

  it("un plan sin mensualidades sigue cerrando", async () => {
    conCotizacionDe(500_000.01);

    await createPaymentPlan("quote-1", {
      downPaymentPct: 50,
      monthsCount: 0,
      deliveryPaymentPct: 50,
    });

    const suma = parcialidadesCreadas().reduce((a, b) => a + b, 0);
    expect(Number(suma.toFixed(2))).toBe(500_000.01);
  });

  it("rechaza el plan que se pasa del 100% en vez de generar parcialidades negativas", async () => {
    conCotizacionDe(1_000_000);

    const result = await createPaymentPlan("quote-1", {
      downPaymentPct: 80,
      monthsCount: 12,
      deliveryPaymentPct: 40,
    });

    expect(result).toHaveProperty("error");
    expect(paymentPlanCreate).not.toHaveBeenCalled();
  });
});

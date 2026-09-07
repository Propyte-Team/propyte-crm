import { describe, it, expect } from "vitest";
import {
  createQuoteSchema,
  updateQuoteSchema,
  paymentPlanSchema,
  primerMensaje,
} from "./quote";

const base = {
  dealId: "deal-1",
  currency: "MXN",
  listPrice: 1_000_000,
  scheme: "FINANCIAMIENTO_DIRECTO",
};

describe("createQuoteSchema", () => {
  it("acepta una cotización mínima y pone el descuento en 0", () => {
    const parsed = createQuoteSchema.parse(base);
    expect(parsed.discountPct).toBe(0);
    expect(parsed.listPrice).toBe(1_000_000);
  });

  it("rechaza el descuento negativo que inflaba el precio final", () => {
    // Antes: 1,000,000 × (1 − (−500/100)) = 6,000,000 guardado como precio final.
    const res = createQuoteSchema.safeParse({ ...base, discountPct: -500 });
    expect(res.success).toBe(false);
    if (!res.success) expect(primerMensaje(res.error)).toMatch(/negativo/i);
  });

  it("rechaza el descuento mayor a 100 que dejaba el precio en negativo", () => {
    const res = createQuoteSchema.safeParse({ ...base, discountPct: 150 });
    expect(res.success).toBe(false);
    if (!res.success) expect(primerMensaje(res.error)).toMatch(/mayor a 100/i);
  });

  it("rechaza precio de lista en cero o negativo", () => {
    expect(createQuoteSchema.safeParse({ ...base, listPrice: 0 }).success).toBe(false);
    expect(createQuoteSchema.safeParse({ ...base, listPrice: -5 }).success).toBe(false);
  });

  it("rechaza precio de lista no numérico en vez de reventar en Prisma", () => {
    const res = createQuoteSchema.safeParse({ ...base, listPrice: "un millón" });
    expect(res.success).toBe(false);
  });

  it("rechaza moneda y esquema fuera del enum", () => {
    expect(createQuoteSchema.safeParse({ ...base, currency: "EUR" }).success).toBe(false);
    expect(createQuoteSchema.safeParse({ ...base, scheme: "MENSUALIDADES" }).success).toBe(false);
  });

  it("exige dealId", () => {
    const { dealId, ...sinDeal } = base;
    expect(createQuoteSchema.safeParse(sinDeal).success).toBe(false);
  });

  it("convierte expiresAt de texto ISO a fecha", () => {
    const parsed = createQuoteSchema.parse({ ...base, expiresAt: "2026-12-31T00:00:00.000Z" });
    expect(parsed.expiresAt).toBeInstanceOf(Date);
  });
});

describe("updateQuoteSchema", () => {
  it("acepta un cambio de estatus solo", () => {
    expect(updateQuoteSchema.parse({ status: "SENT" })).toEqual({ status: "SENT" });
  });
  it("aplica las mismas cotas al descuento", () => {
    expect(updateQuoteSchema.safeParse({ discountPct: -1 }).success).toBe(false);
    expect(updateQuoteSchema.safeParse({ discountPct: 101 }).success).toBe(false);
    expect(updateQuoteSchema.safeParse({ discountPct: 15 }).success).toBe(true);
  });
  it("rechaza un estatus inventado", () => {
    expect(updateQuoteSchema.safeParse({ status: "PAGADA" }).success).toBe(false);
  });
});

describe("paymentPlanSchema", () => {
  it("acepta un plan típico y pone la entrega en 0", () => {
    const parsed = paymentPlanSchema.parse({ downPaymentPct: 10, monthsCount: 24 });
    expect(parsed.deliveryPaymentPct).toBe(0);
  });

  it("rechaza que enganche y entrega pasen de 100%", () => {
    const res = paymentPlanSchema.safeParse({
      downPaymentPct: 70,
      monthsCount: 12,
      deliveryPaymentPct: 40,
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(primerMensaje(res.error)).toMatch(/100%/);
  });

  it("rechaza meses fraccionarios o negativos", () => {
    expect(paymentPlanSchema.safeParse({ downPaymentPct: 10, monthsCount: 12.5 }).success).toBe(false);
    expect(paymentPlanSchema.safeParse({ downPaymentPct: 10, monthsCount: -1 }).success).toBe(false);
  });

  it("acepta cero meses (pago de contado)", () => {
    expect(paymentPlanSchema.safeParse({ downPaymentPct: 100, monthsCount: 0 }).success).toBe(true);
  });

  it("rechaza monthsCount no numérico (NaN de Number('abc'))", () => {
    expect(paymentPlanSchema.safeParse({ downPaymentPct: 10, monthsCount: NaN }).success).toBe(false);
  });
});

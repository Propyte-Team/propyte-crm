import { describe, it, expect } from "vitest";
import { buildInstallmentPlan, computeFinalPrice, toCents } from "./pricing";

/** Suma de todas las parcialidades del plan, en centavos, para comparar sin ruido. */
function sumaEnCentavos(plan: ReturnType<typeof buildInstallmentPlan>): number {
  return (
    toCents(plan.downPaymentAmount) +
    toCents(plan.deliveryAmount) +
    plan.monthlyAmounts.reduce((acc, m) => acc + toCents(m), 0)
  );
}

describe("computeFinalPrice", () => {
  it("sin descuento devuelve el precio de lista", () => {
    expect(computeFinalPrice(1_000_000)).toBe(1_000_000);
  });
  it("aplica el descuento y redondea al centavo", () => {
    expect(computeFinalPrice(1_000_000, 10)).toBe(900_000);
    expect(computeFinalPrice(3_333_333.33, 7.5)).toBe(3_083_333.33);
  });
  it("descuento de 100% deja el precio en cero", () => {
    expect(computeFinalPrice(1_000_000, 100)).toBe(0);
  });
});

describe("buildInstallmentPlan", () => {
  it("el caso de la auditoría: 1,000,000 con 10% de enganche y 7 mensualidades cierra exacto", () => {
    const plan = buildInstallmentPlan({
      finalPrice: 1_000_000,
      downPaymentPct: 10,
      monthsCount: 7,
    });

    expect(plan.downPaymentAmount).toBe(100_000);
    expect(plan.monthlyAmounts).toHaveLength(7);
    // 900,000 / 7 = 128,571.428…: seis de 128,571.42 y la última con el residuo.
    expect(plan.monthlyAmount).toBe(128_571.42);
    expect(plan.monthlyAmounts.slice(0, 6)).toEqual(Array(6).fill(128_571.42));
    expect(plan.monthlyAmounts[6]).toBe(128_571.48);

    // Lo que antes fallaba: 128,571.43 × 7 daba 900,000.01.
    expect(sumaEnCentavos(plan)).toBe(toCents(1_000_000));
    expect(plan.total).toBe(1_000_000);
  });

  it("cierra exacto en un plan largo con números feos", () => {
    const finalPrice = computeFinalPrice(4_275_990.55, 3.7);
    const plan = buildInstallmentPlan({
      finalPrice,
      downPaymentPct: 12.5,
      monthsCount: 60,
      deliveryPaymentPct: 20,
    });

    expect(plan.monthlyAmounts).toHaveLength(60);
    expect(sumaEnCentavos(plan)).toBe(toCents(finalPrice));
  });

  it("el residuo se carga en la última mensualidad, nunca en las anteriores", () => {
    const plan = buildInstallmentPlan({ finalPrice: 100_000, downPaymentPct: 0, monthsCount: 3 });
    const [a, b, c] = plan.monthlyAmounts;
    expect(a).toBe(b);
    expect(c).toBeGreaterThanOrEqual(b);
    expect(sumaEnCentavos(plan)).toBe(toCents(100_000));
  });

  it("sin mensualidades el resto va al pago contra entrega", () => {
    const plan = buildInstallmentPlan({
      finalPrice: 1_000_000,
      downPaymentPct: 30,
      monthsCount: 0,
      deliveryPaymentPct: 20,
    });

    expect(plan.monthlyAmounts).toEqual([]);
    expect(plan.downPaymentAmount).toBe(300_000);
    expect(plan.deliveryAmount).toBe(700_000);
    expect(sumaEnCentavos(plan)).toBe(toCents(1_000_000));
  });

  it("de contado, sin mensualidades ni entrega, todo queda en el enganche", () => {
    const plan = buildInstallmentPlan({ finalPrice: 850_000.37, downPaymentPct: 100, monthsCount: 0 });
    expect(plan.downPaymentAmount).toBe(850_000.37);
    expect(sumaEnCentavos(plan)).toBe(toCents(850_000.37));
  });

  it("enganche y entrega que suman 100 no dejan un centavo colgando", () => {
    const plan = buildInstallmentPlan({
      finalPrice: 10.01,
      downPaymentPct: 50,
      monthsCount: 0,
      deliveryPaymentPct: 50,
    });
    expect(sumaEnCentavos(plan)).toBe(toCents(10.01));
  });

  it("precio en cero produce parcialidades en cero, no NaN", () => {
    const plan = buildInstallmentPlan({ finalPrice: 0, downPaymentPct: 10, monthsCount: 4 });
    expect(plan.monthlyAmounts).toEqual([0, 0, 0, 0]);
    expect(plan.total).toBe(0);
  });

  it("rechaza porcentajes que suman más de 100", () => {
    expect(() =>
      buildInstallmentPlan({
        finalPrice: 1_000_000,
        downPaymentPct: 70,
        monthsCount: 12,
        deliveryPaymentPct: 40,
      })
    ).toThrow(RangeError);
  });

  it("rechaza valores negativos", () => {
    expect(() =>
      buildInstallmentPlan({ finalPrice: 1_000_000, downPaymentPct: -10, monthsCount: 12 })
    ).toThrow(RangeError);
  });
});

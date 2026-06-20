import { describe, it, expect } from "vitest";
import { deriveInvestmentProfile } from "./profile-mapping";

const D = (external: Record<string, unknown>) => deriveInvestmentProfile(external);

describe("deriveInvestmentProfile · interés principal", () => {
  it("ES", () => {
    expect(D({ interes_principal: "Comprar para inversión (plusvalía / renta)" }).investmentProfile).toBe("INVESTOR_RENTAL");
    expect(D({ interes_principal: "Comprar para vivir" }).investmentProfile).toBe("END_USER");
    expect(D({ interes_principal: "Viendo opciones" }).investmentProfile).toBe("MIXED");
  });
  it("EN", () => {
    expect(D({ buscas_invertir: "Buying for investment (vacation rental / capital gains)" }).investmentProfile).toBe("INVESTOR_RENTAL");
    expect(D({ buscas_invertir: "Buying to live" }).investmentProfile).toBe("END_USER");
    expect(D({ buscas_invertir: "Looking at options" }).investmentProfile).toBe("MIXED");
  });
});

describe("deriveInvestmentProfile · forma de pago", () => {
  it("ES/EN", () => {
    expect(D({ forma_adquisicion: "Pago de contado" }).paymentMethod).toBe("CONTADO");
    expect(D({ forma_adquisicion: "Cash payment" }).paymentMethod).toBe("CONTADO");
    expect(D({ forma_adquisicion: "Financiamiento con banco" }).paymentMethod).toBe("CREDITO_HIPOTECARIO");
    expect(D({ forma_adquisicion: "Financing with a bank" }).paymentMethod).toBe("CREDITO_HIPOTECARIO");
    expect(D({ forma_adquisicion: "No tengo claro" }).paymentMethod).toBeUndefined();
    expect(D({ forma_adquisicion: "Not sure" }).paymentMethod).toBeUndefined();
  });
});

describe("deriveInvestmentProfile · urgencia", () => {
  it("ES", () => {
    expect(D({ urgencia: "Ya mismo" }).purchaseTimeline).toBe("IMMEDIATE");
    expect(D({ urgencia: "En el próximo mes" }).purchaseTimeline).toBe("ONE_TO_THREE_MONTHS");
    expect(D({ urgencia: "En los próximos 3 meses" }).purchaseTimeline).toBe("THREE_TO_SIX_MONTHS");
    expect(D({ urgencia: "Todavía no lo decidí" }).purchaseTimeline).toBeUndefined();
  });
  it("EN", () => {
    expect(D({ urgencia: "Right now" }).purchaseTimeline).toBe("IMMEDIATE");
    expect(D({ urgencia: "Next month" }).purchaseTimeline).toBe("ONE_TO_THREE_MONTHS");
    expect(D({ urgencia: "In the next 3 months" }).purchaseTimeline).toBe("THREE_TO_SIX_MONTHS");
    expect(D({ urgencia: "Not sure yet" }).purchaseTimeline).toBeUndefined();
  });
});

describe("deriveInvestmentProfile · presupuesto (nativo, sin conversión)", () => {
  it("ES MDP → pesos", () => {
    expect(D({ presupuesto: "Menos de $1.5 MDP" })).toMatchObject({ budgetMax: 1_500_000, budgetCurrency: "MXN" });
    expect(D({ presupuesto: "$1.5 – $3 MDP" })).toMatchObject({ budgetMin: 1_500_000, budgetMax: 3_000_000, budgetCurrency: "MXN" });
    expect(D({ presupuesto: "$3 – $6 MDP" })).toMatchObject({ budgetMin: 3_000_000, budgetMax: 6_000_000, budgetCurrency: "MXN" });
    expect(D({ presupuesto: "Más de $6 MDP" })).toMatchObject({ budgetMin: 6_000_000, budgetCurrency: "MXN" });
  });
  it("EN USD → nativo", () => {
    expect(D({ presupuesto: "Less than $50,000 USD" })).toMatchObject({ budgetMax: 50_000, budgetCurrency: "USD" });
    expect(D({ presupuesto: "$50,000 – $150,000 USD" })).toMatchObject({ budgetMin: 50_000, budgetMax: 150_000, budgetCurrency: "USD" });
    expect(D({ presupuesto: "$150,000 – $300,000 USD" })).toMatchObject({ budgetMin: 150_000, budgetMax: 300_000, budgetCurrency: "USD" });
    expect(D({ presupuesto: "More than $300,000 USD" })).toMatchObject({ budgetMin: 300_000, budgetCurrency: "USD" });
  });
});

describe("deriveInvestmentProfile · datos basura no inventan valores", () => {
  it("dummy del test lead → todo vacío salvo lo que matchee", () => {
    const r = D({
      buscas_invertir: "<test lead: dummy data>",
      forma_adquisicion: "<test lead: dummy data>",
      urgencia: "<test lead: dummy data>",
      presupuesto: "<test lead: dummy data>",
    });
    expect(r.investmentProfile).toBeUndefined();
    expect(r.paymentMethod).toBeUndefined();
    expect(r.purchaseTimeline).toBeUndefined();
    expect(r.budgetMin).toBeUndefined();
    expect(r.budgetMax).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #711 · AUD-20260903 S-01 y D-09.
//
// Todo lo que cuelga de un negocio se conformaba con que hubiera sesión: un asesor (o una
// hostess, o un broker externo) podía leer y editar por id las cotizaciones, los planes de
// pago, las parcialidades y los documentos —INE, comprobantes, contratos— de toda la
// empresa. Estas pruebas fallan enteras con el código anterior.

const dealFindFirst = vi.fn();
const quoteFindMany = vi.fn();
const quoteFindFirst = vi.fn();
const quoteCreate = vi.fn();
const quoteUpdate = vi.fn();
const scheduleFindUnique = vi.fn();
const scheduleUpdate = vi.fn();
const docFindMany = vi.fn();
const docCreate = vi.fn();
const docFindUnique = vi.fn();
const docUpdate = vi.fn();
const planCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    deal: { findFirst: (...a: unknown[]) => dealFindFirst(...a) },
    quote: {
      findMany: (...a: unknown[]) => quoteFindMany(...a),
      findFirst: (...a: unknown[]) => quoteFindFirst(...a),
      create: (...a: unknown[]) => quoteCreate(...a),
      update: (...a: unknown[]) => quoteUpdate(...a),
    },
    paymentSchedule: {
      findUnique: (...a: unknown[]) => scheduleFindUnique(...a),
      update: (...a: unknown[]) => scheduleUpdate(...a),
    },
    paymentPlan: { create: (...a: unknown[]) => planCreate(...a) },
    dealDocument: {
      findMany: (...a: unknown[]) => docFindMany(...a),
      create: (...a: unknown[]) => docCreate(...a),
      findUnique: (...a: unknown[]) => docFindUnique(...a),
      update: (...a: unknown[]) => docUpdate(...a),
    },
  },
}));

const sesion = { user: { id: "asesor-1", role: "ASESOR", plaza: "PDC" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));

import {
  getQuotesByDeal,
  createQuote,
  updateQuote,
  createPaymentPlan,
  updateInstallment,
  getDocumentsByDeal,
  addDocument,
  deleteDocument,
} from "./quotes";
import { FUERA_DE_ALCANCE } from "@/lib/rbac/deal-access";

const DEAL_AJENO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** El negocio existe, pero es de otro asesor de otra plaza. */
function negocioAjeno() {
  dealFindFirst.mockResolvedValue({
    id: DEAL_AJENO,
    assignedToId: "otro-asesor",
    assignedTo: { plaza: "TULUM", teamLeaderId: "otro-tl" },
  });
}

function negocioPropio() {
  dealFindFirst.mockResolvedValue({
    id: DEAL_AJENO,
    assignedToId: "asesor-1",
    assignedTo: { plaza: "PDC", teamLeaderId: null },
  });
}

beforeEach(() => {
  sesion.user = { id: "asesor-1", role: "ASESOR", plaza: "PDC" };
  for (const m of [
    dealFindFirst, quoteFindMany, quoteFindFirst, quoteCreate, quoteUpdate,
    scheduleFindUnique, scheduleUpdate, docFindMany, docCreate, docFindUnique,
    docUpdate, planCreate,
  ]) m.mockReset();

  quoteFindFirst.mockResolvedValue({ id: "q1", dealId: DEAL_AJENO, listPrice: 1, discountPct: 0 });
  scheduleFindUnique.mockResolvedValue({
    id: "s1",
    plan: { quote: { dealId: DEAL_AJENO } },
  });
  docFindUnique.mockResolvedValue({ id: "d1", dealId: DEAL_AJENO });
  quoteFindMany.mockResolvedValue([]);
  docFindMany.mockResolvedValue([]);
});

const cotizacionValida = {
  dealId: DEAL_AJENO,
  currency: "MXN",
  listPrice: 1_000_000,
  scheme: "CONTADO",
};

describe("cotizaciones y documentos de un negocio ajeno (#711)", () => {
  it("no deja listar las cotizaciones", async () => {
    negocioAjeno();
    await expect(getQuotesByDeal(DEAL_AJENO)).rejects.toThrow(FUERA_DE_ALCANCE);
    expect(quoteFindMany).not.toHaveBeenCalled();
  });

  it("no deja crear una cotización", async () => {
    negocioAjeno();
    const r = await createQuote(cotizacionValida);
    expect(r).toEqual({ error: FUERA_DE_ALCANCE });
    expect(quoteCreate).not.toHaveBeenCalled();
  });

  it("no deja editar una cotización ajena", async () => {
    negocioAjeno();
    const r = await updateQuote("q1", { discountPct: 90 });
    expect(r).toEqual({ error: FUERA_DE_ALCANCE });
    expect(quoteUpdate).not.toHaveBeenCalled();
  });

  it("no deja crear un plan de pagos sobre una cotización ajena", async () => {
    negocioAjeno();
    quoteFindFirst.mockResolvedValue({ id: "q1", dealId: DEAL_AJENO, finalPrice: 1_000_000, paymentPlan: null });
    const r = await createPaymentPlan("q1", { downPaymentPct: 10, monthsCount: 12 });
    expect(r).toEqual({ error: FUERA_DE_ALCANCE });
    expect(planCreate).not.toHaveBeenCalled();
  });

  it("no deja marcar como pagada una parcialidad ajena", async () => {
    // D-09: esto era lo más burdo — el id de la cotización de la URL ni siquiera se usaba.
    negocioAjeno();
    const r = await updateInstallment("s1", { status: "PAGADA" });
    expect(r).toEqual({ error: FUERA_DE_ALCANCE });
    expect(scheduleUpdate).not.toHaveBeenCalled();
  });

  it("no deja leer los documentos: INE, comprobantes, contratos", async () => {
    negocioAjeno();
    await expect(getDocumentsByDeal(DEAL_AJENO)).rejects.toThrow(FUERA_DE_ALCANCE);
    expect(docFindMany).not.toHaveBeenCalled();
  });

  it("no deja subir ni borrar documentos", async () => {
    negocioAjeno();
    const alta = await addDocument(DEAL_AJENO, { type: "KYC", name: "INE", url: "http://x" });
    expect(alta).toEqual({ error: FUERA_DE_ALCANCE });
    expect(docCreate).not.toHaveBeenCalled();

    const baja = await deleteDocument("d1");
    expect(baja).toEqual({ error: FUERA_DE_ALCANCE });
    expect(docUpdate).not.toHaveBeenCalled();
  });
});

describe("el dueño del negocio sigue trabajando igual (#711)", () => {
  it("lista, crea y edita lo suyo", async () => {
    negocioPropio();
    quoteCreate.mockResolvedValue({ id: "q1", listPrice: 1, discountPct: 0, finalPrice: 1 });
    quoteUpdate.mockResolvedValue({ id: "q1", listPrice: 1, discountPct: 0, finalPrice: 1 });

    await expect(getQuotesByDeal(DEAL_AJENO)).resolves.toEqual([]);
    expect(await createQuote(cotizacionValida)).toHaveProperty("quote");
    expect(await updateQuote("q1", { discountPct: 10 })).toHaveProperty("quote");
  });

  it("dirección entra a cualquier negocio", async () => {
    negocioAjeno();
    sesion.user = { id: "dir-1", role: "DIRECTOR", plaza: "PDC" };

    await expect(getDocumentsByDeal(DEAL_AJENO)).resolves.toEqual([]);
  });

  it("marketing puede mirar pero no escribir", async () => {
    negocioAjeno();
    sesion.user = { id: "mkt-1", role: "MARKETING", plaza: "PDC" };

    await expect(getQuotesByDeal(DEAL_AJENO)).resolves.toEqual([]);
    expect(await updateQuote("q1", { discountPct: 10 })).toEqual({ error: FUERA_DE_ALCANCE });
  });
});

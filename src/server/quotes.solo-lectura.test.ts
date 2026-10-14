import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// #867 · Dos cosas:
//  1. DIRECTOR y MARKETING ven cotizaciones pero NO las modifican: crear, editar, enviar,
//     borrar, armar plan y registrar pagos se rechazan con «solo lectura» (403 en la ruta).
//  2. El DELETE de /api/quotes/[id] borraba cualquier cotización con solo tener sesión: la
//     #711 cubrió las demás escrituras pero el borrado vivía en la ruta y se le pasó.

const dealFindFirst = vi.fn();
const quoteFindFirst = vi.fn();
const quoteCreate = vi.fn();
const quoteUpdate = vi.fn();
const scheduleFindUnique = vi.fn();
const scheduleUpdate = vi.fn();
const planCreate = vi.fn();

vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: async () => "ALL" }));
vi.mock("@/lib/db", () => ({
  default: {
    deal: { findFirst: (...a: unknown[]) => dealFindFirst(...a) },
    quote: {
      findFirst: (...a: unknown[]) => quoteFindFirst(...a),
      create: (...a: unknown[]) => quoteCreate(...a),
      update: (...a: unknown[]) => quoteUpdate(...a),
    },
    paymentSchedule: {
      findUnique: (...a: unknown[]) => scheduleFindUnique(...a),
      update: (...a: unknown[]) => scheduleUpdate(...a),
    },
    paymentPlan: { create: (...a: unknown[]) => planCreate(...a) },
  },
}));

const sesion = { user: { id: "dir-1", role: "DIRECTOR", plaza: "PDC" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));

import {
  createQuote,
  updateQuote,
  sendQuote,
  deleteQuote,
  createPaymentPlan,
  updateInstallment,
} from "./quotes";
import { DELETE } from "@/app/api/quotes/[id]/route";
import { FUERA_DE_ALCANCE } from "@/lib/rbac/deal-access";
import { SOLO_LECTURA_COTIZACIONES } from "@/lib/rbac/quote-scope";

const DEAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const cotizacionValida = { dealId: DEAL, currency: "MXN", listPrice: 1_000_000, scheme: "CONTADO" };
const escrituras = [quoteCreate, quoteUpdate, scheduleUpdate, planCreate];

function negocioDe(assignedToId: string, plaza = "PDC", teamLeaderId: string | null = null) {
  dealFindFirst.mockResolvedValue({ id: DEAL, assignedToId, assignedTo: { plaza, teamLeaderId } });
}

const borrar = (id = "q1") =>
  DELETE(new Request("http://x/api/quotes/q1", { method: "DELETE" }) as never, {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  for (const m of [dealFindFirst, quoteFindFirst, quoteCreate, quoteUpdate, scheduleFindUnique, scheduleUpdate, planCreate]) m.mockReset();
  quoteFindFirst.mockResolvedValue({ id: "q1", dealId: DEAL, listPrice: 1, discountPct: 0, finalPrice: 1_000_000, paymentPlan: null });
  scheduleFindUnique.mockResolvedValue({ id: "s1", plan: { quote: { dealId: DEAL } } });
  quoteUpdate.mockResolvedValue({ id: "q1" });
  negocioDe("asesor-x");
});

describe.each(["DIRECTOR", "MARKETING"])("%s: ve cotizaciones, no las modifica", (role) => {
  beforeEach(() => {
    sesion.user = { id: "u-1", role, plaza: "PDC" };
  });

  it("no crea", async () => {
    expect(await createQuote(cotizacionValida)).toEqual({ error: SOLO_LECTURA_COTIZACIONES });
  });
  it("no edita", async () => {
    expect(await updateQuote("q1", { discountPct: 5 })).toEqual({ error: SOLO_LECTURA_COTIZACIONES });
  });
  it("no envía", async () => {
    expect(await sendQuote("q1")).toEqual({ error: SOLO_LECTURA_COTIZACIONES });
  });
  it("no borra", async () => {
    expect(await deleteQuote("q1")).toEqual({ error: SOLO_LECTURA_COTIZACIONES });
  });
  it("no arma plan de pagos", async () => {
    const r = await createPaymentPlan("q1", { downPaymentPct: 30, monthsCount: 12, deliveryPaymentPct: 0, startDate: "2026-11-01" });
    expect(r).toEqual({ error: SOLO_LECTURA_COTIZACIONES });
  });
  it("no registra pagos", async () => {
    expect(await updateInstallment("s1", { status: "PAGADA" })).toEqual({ error: SOLO_LECTURA_COTIZACIONES });
  });
  it("la ruta DELETE responde 403", async () => {
    const res = await borrar();
    expect(res.status).toBe(403);
  });

  // Después de CADA caso de arriba (no como caso aparte: el beforeEach resetea los mocks).
  afterEach(() => {
    for (const m of escrituras) expect(m).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/quotes/[id] respeta de quién es la cotización", () => {
  it("un ASESOR no borra la cotización de un negocio ajeno (404, sin escribir)", async () => {
    sesion.user = { id: "asesor-1", role: "ASESOR", plaza: "PDC" };
    negocioDe("otro-asesor", "TULUM");
    const res = await borrar();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: FUERA_DE_ALCANCE });
    expect(quoteUpdate).not.toHaveBeenCalled();
  });

  it("un ASESOR sí borra la de su negocio", async () => {
    sesion.user = { id: "asesor-1", role: "ASESOR", plaza: "PDC" };
    negocioDe("asesor-1");
    const res = await borrar();
    expect(res.status).toBe(200);
    expect(quoteUpdate).toHaveBeenCalledWith({ where: { id: "q1" }, data: { deletedAt: expect.any(Date) } });
  });

  it("un TEAM_LEADER no borra la de un asesor de OTRO equipo de su misma plaza", async () => {
    sesion.user = { id: "tl-1", role: "TEAM_LEADER", plaza: "PDC" };
    negocioDe("asesor-de-otro-equipo", "PDC", "tl-2");
    expect((await borrar()).status).toBe(404);
    expect(quoteUpdate).not.toHaveBeenCalled();
  });

  it("un TEAM_LEADER sí borra la de un asesor de su equipo", async () => {
    sesion.user = { id: "tl-1", role: "TEAM_LEADER", plaza: "PDC" };
    negocioDe("asesor-de-mi-equipo", "PDC", "tl-1");
    expect((await borrar()).status).toBe(200);
  });

  it("cotización inexistente → 404", async () => {
    sesion.user = { id: "a-1", role: "ADMIN", plaza: "PDC" };
    quoteFindFirst.mockResolvedValue(null);
    expect((await borrar()).status).toBe(404);
  });
});

describe("los roles que sí escriben siguen pudiendo", () => {
  it.each([
    ["ADMIN", "otro-asesor", "TULUM", null],
    ["GERENTE", "asesor-de-su-plaza", "PDC", null],
    ["TEAM_LEADER", "asesor-de-su-equipo", "PDC", "u-1"],
    ["ASESOR_SR", "u-1", "PDC", null],
  ] as const)("%s edita", async (role, dueño, plaza, tl) => {
    sesion.user = { id: "u-1", role, plaza: "PDC" };
    negocioDe(dueño, plaza, tl);
    const r = await updateQuote("q1", { notes: "ok" });
    expect(r).not.toHaveProperty("error");
    expect(quoteUpdate).toHaveBeenCalled();
  });
});

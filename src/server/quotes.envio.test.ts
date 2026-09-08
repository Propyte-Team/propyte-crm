import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #738 · AUD-20260903 D-14 + hallazgo N-1 del repaso posterior al PR #47.
//
// El envío de cotización vivía en la ruta y eran DOS escrituras sueltas: primero
// `updateQuote(status: SENT)` y después un `prisma.quote.update` con `sentAt: new Date()`.
// De ahí dos defectos, y las dos primeras pruebas de este archivo fallan con ese código:
//
//  1. Cada POST pisaba `sentAt`, así que un reenvío borraba la fecha del primer envío
//     —justo el campo por el que la métrica COTIZACIONES_ENVIADAS de las metas filtra.
//  2. La comprobación de acceso que se agregó en #711 quedó DESPUÉS de la escritura de
//     `sentAt`, así que un POST rechazado devolvía 404 y dejaba la cotización ajena
//     marcada como enviada.

const dealFindFirst = vi.fn();
const quoteFindFirst = vi.fn();
const quoteUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    deal: { findFirst: (...a: unknown[]) => dealFindFirst(...a) },
    quote: {
      findFirst: (...a: unknown[]) => quoteFindFirst(...a),
      update: (...a: unknown[]) => quoteUpdate(...a),
    },
  },
}));

const sesion = { user: { id: "asesor-1", role: "ASESOR", plaza: "PDC" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));

import { sendQuote } from "./quotes";
import { FUERA_DE_ALCANCE } from "@/lib/rbac/deal-access";

const QUOTE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DEAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRIMER_ENVIO = new Date("2026-09-01T15:00:00.000Z");

function negocioPropio() {
  dealFindFirst.mockResolvedValue({
    id: DEAL,
    assignedToId: "asesor-1",
    assignedTo: { plaza: "PDC", teamLeaderId: null },
  });
}

function negocioAjeno() {
  dealFindFirst.mockResolvedValue({
    id: DEAL,
    assignedToId: "otro-asesor",
    assignedTo: { plaza: "TULUM", teamLeaderId: "otro-tl" },
  });
}

/** Cotización existente; `sentAt` null salvo que se indique. */
function cotizacion(sentAt: Date | null = null) {
  quoteFindFirst.mockResolvedValue({ id: QUOTE, dealId: DEAL, status: "DRAFT", sentAt });
}

/** Los campos que se mandaron a escribir. */
function datosEscritos(): Record<string, unknown> {
  return quoteUpdate.mock.calls[0][0].data;
}

beforeEach(() => {
  for (const m of [dealFindFirst, quoteFindFirst, quoteUpdate]) m.mockReset();

  quoteUpdate.mockResolvedValue({
    id: QUOTE,
    dealId: DEAL,
    status: "SENT",
    listPrice: 1_000_000,
    discountPct: 0,
    finalPrice: 1_000_000,
    fxRate: null,
    paymentPlan: null,
  });
});

describe("sendQuote — reenvío (#738)", () => {
  it("el primer envío sella la fecha", async () => {
    negocioPropio();
    cotizacion(null);

    const res = await sendQuote(QUOTE);

    expect(res).toHaveProperty("quote");
    expect(datosEscritos().status).toBe("SENT");
    expect(datosEscritos().sentAt).toBeInstanceOf(Date);
  });

  it("un reenvío NO pisa la fecha del primer envío", async () => {
    negocioPropio();
    cotizacion(PRIMER_ENVIO);

    await sendQuote(QUOTE);

    // La clave ni se manda: Prisma deja el valor que ya había.
    expect(datosEscritos()).not.toHaveProperty("sentAt");
    expect(datosEscritos().status).toBe("SENT");
  });

  it("es una sola escritura, no dos", async () => {
    negocioPropio();
    cotizacion(null);

    await sendQuote(QUOTE);

    expect(quoteUpdate).toHaveBeenCalledOnce();
  });
});

describe("sendQuote — validar antes de escribir (#738)", () => {
  it("una cotización de un negocio ajeno no se marca como enviada", async () => {
    negocioAjeno();
    cotizacion(null);

    expect(await sendQuote(QUOTE)).toEqual({ error: FUERA_DE_ALCANCE });
    expect(quoteUpdate).not.toHaveBeenCalled();
  });

  it("una cotización que no existe no escribe nada", async () => {
    negocioPropio();
    quoteFindFirst.mockResolvedValue(null);

    expect(await sendQuote(QUOTE)).toEqual({ error: "Cotización no encontrada" });
    expect(quoteUpdate).not.toHaveBeenCalled();
  });

  it("sin sesión no llega ni a buscarla", async () => {
    const original = sesion.user;
    // @ts-expect-error — se simula la ausencia de sesión.
    sesion.user = undefined;

    await expect(sendQuote(QUOTE)).rejects.toThrow("No autorizado");
    expect(quoteFindFirst).not.toHaveBeenCalled();

    sesion.user = original;
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #738, la verificación de extremo a extremo: la ruta POST de envío.
//
// Estas dos pruebas son el negativo del arreglo y fallan contra el código anterior, donde
// la ruta hacía `prisma.quote.update({ data: { sentAt: new Date() } })` SIN CONDICIÓN y
// solo después miraba el `if ("error" in result)`. O sea: un envío rechazado por falta de
// acceso devolvía 404 y aun así estampaba la fecha, y un reenvío legítimo la pisaba.

const quoteFindFirst = vi.fn();
const quoteUpdate = vi.fn();
const dealFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    quote: {
      findFirst: (...a: unknown[]) => quoteFindFirst(...a),
      update: (...a: unknown[]) => quoteUpdate(...a),
    },
    deal: { findFirst: (...a: unknown[]) => dealFindFirst(...a) },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "asesor-1", role: "ASESOR", plaza: "PDC" } }),
}));

import { POST } from "./route";

const QUOTE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DEAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRIMER_ENVIO = new Date("2026-09-01T15:00:00.000Z");

function enviar() {
  return POST(
    new Request(`http://t/api/quotes/${QUOTE}/send`, { method: "POST" }) as never,
    { params: { id: QUOTE } }
  );
}

/** Todos los `data` que se mandaron a escribir, en orden. */
function escrituras(): Record<string, unknown>[] {
  return quoteUpdate.mock.calls.map((c) => c[0].data);
}

beforeEach(() => {
  for (const m of [quoteFindFirst, quoteUpdate, dealFindFirst]) m.mockReset();

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

describe("POST /api/quotes/[id]/send (#738)", () => {
  it("un envío rechazado por acceso no escribe NADA", async () => {
    quoteFindFirst.mockResolvedValue({ id: QUOTE, dealId: DEAL, status: "DRAFT", sentAt: null });
    // El negocio es de otro asesor, de otra plaza.
    dealFindFirst.mockResolvedValue({
      id: DEAL,
      assignedToId: "otro-asesor",
      assignedTo: { plaza: "TULUM", teamLeaderId: "otro-tl" },
    });

    const res = await enviar();

    expect(res.status).toBe(404);
    // Lo importante: la cotización ajena NO quedó marcada como enviada.
    expect(quoteUpdate).not.toHaveBeenCalled();
  });

  it("un reenvío conserva la fecha del primer envío", async () => {
    quoteFindFirst.mockResolvedValue({
      id: QUOTE,
      dealId: DEAL,
      status: "SENT",
      sentAt: PRIMER_ENVIO,
    });
    dealFindFirst.mockResolvedValue({
      id: DEAL,
      assignedToId: "asesor-1",
      assignedTo: { plaza: "PDC", teamLeaderId: null },
    });

    const res = await enviar();

    expect(res.status).toBe(200);
    // Una sola escritura, y ninguna de ellas toca sentAt.
    expect(quoteUpdate).toHaveBeenCalledOnce();
    for (const data of escrituras()) expect(data).not.toHaveProperty("sentAt");
  });

  it("el primer envío sí sella la fecha", async () => {
    quoteFindFirst.mockResolvedValue({ id: QUOTE, dealId: DEAL, status: "DRAFT", sentAt: null });
    dealFindFirst.mockResolvedValue({
      id: DEAL,
      assignedToId: "asesor-1",
      assignedTo: { plaza: "PDC", teamLeaderId: null },
    });

    const res = await enviar();

    expect(res.status).toBe(200);
    expect(escrituras()[0].sentAt).toBeInstanceOf(Date);
  });
});

// ============================================================
// API Route: /api/quotes/[id]/send
// POST - Marca cotización como SENT y registra sentAt
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { sendQuote } from "@/server/quotes";
import { FUERA_DE_ALCANCE } from "@/lib/rbac/deal-access";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // #738: una sola llamada. Antes la ruta buscaba la cotización, la actualizaba, le
    // estampaba `sentAt` en una segunda escritura y SOLO ENTONCES miraba si algo había
    // fallado — así que un envío rechazado dejaba la cotización marcada como enviada.
    const result = await sendQuote(params.id);

    if ("error" in result) {
      const noEncontrada =
        result.error === FUERA_DE_ALCANCE || result.error === "Cotización no encontrada";
      return NextResponse.json({ error: result.error }, { status: noEncontrada ? 404 : 400 });
    }

    return NextResponse.json({ data: result.quote });
  } catch (error) {
    if (error instanceof Error && error.message === FUERA_DE_ALCANCE) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[POST /api/quotes/[id]/send]", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

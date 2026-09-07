// ============================================================
// API Route: /api/quotes/[id]/send
// POST - Marca cotización como SENT y registra sentAt
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { updateQuote } from "@/server/quotes";
import prisma from "@/lib/db";
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

    const existing = await prisma.quote.findFirst({
      where: { id: params.id, deletedAt: null },
    });
    if (!existing) {
      return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 });
    }

    const result = await updateQuote(params.id, { status: "SENT" });

    // Set sentAt directly
    await prisma.quote.update({
      where: { id: params.id },
      data: { sentAt: new Date() },
    });

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        // #711: fuera de alcance es 404, no 403: un 403 confirma que el id existe.
        { status: result.error === FUERA_DE_ALCANCE ? 404 : 400 },
      );
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

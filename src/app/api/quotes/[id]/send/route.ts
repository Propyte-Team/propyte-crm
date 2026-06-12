// ============================================================
// API Route: /api/quotes/[id]/send
// POST - Marca cotización como SENT y registra sentAt
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { updateQuote } from "@/server/quotes";
import prisma from "@/lib/db";

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
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.quote });
  } catch (error) {
    console.error("[POST /api/quotes/[id]/send]", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

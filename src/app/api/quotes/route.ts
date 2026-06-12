// ============================================================
// API Route: /api/quotes
// GET  - Lista cotizaciones por dealId
// POST - Crea nueva cotización
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getQuotesByDeal, createQuote } from "@/server/quotes";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const dealId = request.nextUrl.searchParams.get("dealId");
    if (!dealId) {
      return NextResponse.json({ error: "dealId es requerido" }, { status: 400 });
    }

    const quotes = await getQuotesByDeal(dealId);
    return NextResponse.json({ data: quotes });
  } catch (error) {
    console.error("[GET /api/quotes]", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const result = await createQuote(body);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.quote }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/quotes]", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

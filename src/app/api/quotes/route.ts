// ============================================================
// API Route: /api/quotes
// GET  - Lista cotizaciones por dealId
// POST - Crea nueva cotización
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getQuotesByDeal, createQuote } from "@/server/quotes";
import { FUERA_DE_ALCANCE } from "@/lib/rbac/deal-access";

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
    if (error instanceof Error && error.message === FUERA_DE_ALCANCE) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
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
      return NextResponse.json(
        { error: result.error },
        // #711: fuera de alcance es 404, no 403: un 403 confirma que el id existe.
        { status: result.error === FUERA_DE_ALCANCE ? 404 : 400 },
      );
    }

    return NextResponse.json({ data: result.quote }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === FUERA_DE_ALCANCE) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[POST /api/quotes]", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

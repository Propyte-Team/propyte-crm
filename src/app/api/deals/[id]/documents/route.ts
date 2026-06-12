// ============================================================
// API Route: /api/deals/[id]/documents
// GET  - Lista documentos del deal
// POST - Agrega documento al deal
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getDocumentsByDeal, addDocument } from "@/server/quotes";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const docs = await getDocumentsByDeal(params.id);
    return NextResponse.json({ data: docs });
  } catch (error) {
    console.error("[GET /api/deals/[id]/documents]", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const result = await addDocument(params.id, body);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.doc }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/deals/[id]/documents]", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

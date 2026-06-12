// ============================================================
// API Route: /api/deals/[id]/documents/[docId]
// DELETE - Soft delete de documento
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { deleteDocument } from "@/server/quotes";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const result = await deleteDocument(params.docId);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/deals/[id]/documents/[docId]]", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

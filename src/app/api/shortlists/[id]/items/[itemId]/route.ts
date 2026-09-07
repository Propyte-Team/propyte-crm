import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { removeItem, updateItemNote } from "@/server/shortlists";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const result = await updateItemNote(params.itemId, params.id, body?.note ?? null, session.user);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ data: result.item });
  } catch (e) {
    console.error("[PATCH /api/shortlists/[id]/items/[itemId]]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const result = await removeItem(params.itemId, params.id, session.user);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/shortlists/[id]/items/[itemId]]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

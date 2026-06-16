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
    const { item } = await updateItemNote(params.itemId, body?.note ?? null);
    return NextResponse.json({ data: item });
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
    await removeItem(params.itemId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/shortlists/[id]/items/[itemId]]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

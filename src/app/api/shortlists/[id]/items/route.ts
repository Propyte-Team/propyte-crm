import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { addItem } from "@/server/shortlists";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    if (!body?.hubUnitId) return NextResponse.json({ error: "hubUnitId es requerido" }, { status: 400 });
    const result = await addItem({ shortlistId: params.id, hubUnitId: body.hubUnitId, note: body.note ?? null });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ data: result.item }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/shortlists/[id]/items]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

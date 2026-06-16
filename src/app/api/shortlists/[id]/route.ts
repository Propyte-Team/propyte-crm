import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { sendShortlist, updateShortlistTitle, softDeleteShortlist } from "@/server/shortlists";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    if (body?.action === "send") {
      const { shortlist } = await sendShortlist(params.id);
      return NextResponse.json({ data: shortlist });
    }
    if (typeof body?.title === "string") {
      const { shortlist } = await updateShortlistTitle(params.id, body.title);
      return NextResponse.json({ data: shortlist });
    }
    return NextResponse.json({ error: "Acción no soportada" }, { status: 400 });
  } catch (e) {
    console.error("[PATCH /api/shortlists/[id]]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  await softDeleteShortlist(params.id);
  return NextResponse.json({ ok: true });
}

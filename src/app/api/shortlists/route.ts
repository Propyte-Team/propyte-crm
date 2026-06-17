import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { createShortlist, getShortlistsFor } from "@/server/shortlists";

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const contactId = request.nextUrl.searchParams.get("contactId") ?? undefined;
  const dealId = request.nextUrl.searchParams.get("dealId") ?? undefined;
  if (!contactId && !dealId) {
    return NextResponse.json({ error: "contactId o dealId es requerido" }, { status: 400 });
  }
  const data = await getShortlistsFor({ contactId, dealId });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    if (!body?.contactId) return NextResponse.json({ error: "contactId es requerido" }, { status: 400 });
    const { shortlist } = await createShortlist({
      contactId: body.contactId,
      dealId: body.dealId ?? null,
      createdById: session.user.id,
      title: body.title,
    });
    return NextResponse.json({ data: shortlist }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/shortlists]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

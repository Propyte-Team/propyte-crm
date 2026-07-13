import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { mergeContacts } from "@/server/contacts-dedup";

const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "DEVELOPER_EXT", "MANTENIMIENTO"];

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!FULL_ACCESS_ROLES.includes(session.user.role as string)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  try {
    const body = await request.json();
    if (!body?.survivorId || !body?.loserId) {
      return NextResponse.json({ error: "survivorId y loserId son requeridos" }, { status: 400 });
    }
    const result = await mergeContacts({ survivorId: body.survivorId, loserId: body.loserId, actorId: session.user.id });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ data: result });
  } catch (e) {
    console.error("[POST /api/contacts/merge]", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

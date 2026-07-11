// [TEMPORAL] Diagnóstico del webhook meta-dm. Solo roles internos. Borrar tras depurar.
// Abrir en el navegador (estando logueado en el CRM): /api/webhooks/meta-dm/debug
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getHits } from "@/lib/messaging/webhook-debug";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

export async function GET() {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const hits = getHits();
  return NextResponse.json({ count: hits.length, hits });
}

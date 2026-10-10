// POST: «Probar conexión» del asistente Meta DMs (2026-10-10). Con el Page ID y el token que
// escribió el admin contesta dos cosas, sin guardar nada:
//  - ¿el token es de esa Página? (GET /me, igual que al cambiar el token de una cuenta);
//  - ¿qué cuenta de Instagram Business tiene vinculada? Para proponer el igBusinessId y
//    enseñar el @usuario, en vez de que el admin lo copie a mano de Meta.
//
// Existe como ruta porque el token no puede ir del navegador a Graph: quedaría en el
// historial de red del navegador y en cualquier extensión que lo mire. Aquí va en la
// cabecera Authorization, en el servidor, y no sale en la respuesta.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { metaDmsLookupSchema, firstIssueMessage } from "@/lib/validations/meta-dms";
import { verifyPageToken, pageMismatchMessage, fetchLinkedInstagram } from "@/lib/messaging/page-token";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const parsed = metaDmsLookupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssueMessage(parsed.error) }, { status: 400 });
  const { pageId, pageAccessToken: token } = parsed.data;

  const check = await verifyPageToken(token);
  if (!check.ok) {
    return check.kind === "graph"
      ? NextResponse.json({ error: `Meta rechazó el token: ${check.error}` }, { status: 400 })
      : NextResponse.json({ error: `No se pudo verificar el token con Meta: ${check.error}` }, { status: 502 });
  }
  if (check.pageId !== pageId) {
    return NextResponse.json({ error: pageMismatchMessage(check, pageId) }, { status: 400 });
  }

  // El token ya está probado: si lo de Instagram falla, la prueba no falla. El asistente lo
  // dice y deja escribir el ID a mano (el alta lo vuelve a comprobar antes de guardar).
  const linked = await fetchLinkedInstagram(pageId, token);
  return NextResponse.json({
    data: {
      pageId: check.pageId,
      pageName: check.pageName,
      instagram: linked.ok ? linked.instagram : null,
      instagramError: linked.ok ? null : `No se pudo consultar el Instagram vinculado: ${linked.error}`,
    },
  });
}

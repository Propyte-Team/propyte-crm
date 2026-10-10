// POST: instala la app en la Página de un conector social (`subscribed_apps`)
// con los campos que el CRM necesita, sin quitar los que ya tenía (2026-10-10).
//
// Existe porque la app puede estar perfecta a nivel aplicación y aun así Meta
// no mandar nada de una Página que nunca se suscribió (Yaxnáh). Antes eso solo
// se arreglaba con un token y una llamada a mano; ahora es un botón junto al
// diagnóstico. El token de la Página se usa aquí, en el servidor: nunca sale
// en la respuesta.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { getSocialPageToken } from "@/lib/messaging/social-accounts";
// 2026-10-10: la lectura → suscripción → confirmación vive en ensurePageSubscription porque
// el alta de Meta DMs hace exactamente lo mismo al crear las cuentas.
import { ensurePageSubscription } from "@/lib/messaging/ensure-page-subscription";

export const dynamic = "force-dynamic";

// Mismos roles que /api/admin/connectors: quien puede editar la cuenta puede suscribirla.
const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const connector = await prisma.leadConnector.findFirst({
    where: { id: params.id, provider: { in: ["INSTAGRAM", "MESSENGER"] }, deletedAt: null },
  });
  if (!connector) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });

  const pageId = (connector.config as { pageId?: string } | null)?.pageId;
  const token = getSocialPageToken(connector);
  if (!pageId || !token) {
    return NextResponse.json({ error: "La cuenta no tiene pageId o token" }, { status: 400 });
  }

  // Leer antes de escribir: el POST reemplaza la lista, y sin saber qué había
  // borraríamos campos que alguien suscribió a mano.
  const result = await ensurePageSubscription(pageId, token);
  if (!result.ok) {
    return result.stage === "read"
      ? NextResponse.json({ error: `No se pudo leer la Página: ${result.error}` }, { status: 502 })
      : NextResponse.json({ error: `Meta no aceptó la suscripción: ${result.error}` }, { status: 502 });
  }
  if (!result.changed) {
    return NextResponse.json({ data: { changed: false, subscribedFields: result.subscribedFields } });
  }
  return NextResponse.json({
    data: { changed: true, subscribedFields: result.subscribedFields, missing: result.missing },
  });
}

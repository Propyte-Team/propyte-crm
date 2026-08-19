// GET diagnóstico: por conector social, si los 3 campos están presentes. NUNCA devuelve valores de secretos.
//
// Con `?probe=1` además le pregunta a Meta qué eventos tiene suscrita la Página
// (`subscribed_apps`). Va detrás de un parámetro y no por defecto porque son N
// llamadas a Graph: la pantalla de conectores no debe pagarlas en cada carga.
// Es el diagnóstico que faltaba cuando una regla de comentarios está perfecta y
// no dispara nunca porque el evento jamás llega.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { checkSocialConnector } from "@/lib/messaging/connector-health";
import { getSocialPageToken } from "@/lib/messaging/social-accounts";
import { probePageSubscription, missingCommentFields } from "@/lib/messaging/webhook-subscription";

export const dynamic = "force-dynamic";

// Alineado con /api/admin/connectors (mismo ALLOWED_ROLES): era la única ruta
// de conectores sin MARKETING, así que la diseñadora veía la pantalla pero no
// el diagnóstico de sus propias cuentas.
const ALLOWED = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const withProbe = req.nextUrl.searchParams.get("probe") === "1";

  const connectors = await prisma.leadConnector.findMany({
    where: { provider: { in: ["INSTAGRAM", "MESSENGER"] }, deletedAt: null },
    orderBy: { name: "asc" },
  });

  const data = await Promise.all(
    connectors.map(async (c) => {
      const h = checkSocialConnector(c);
      const base = {
        id: c.id,
        name: c.name,
        provider: c.provider,
        status: c.status,
        ok: h.ok,
        missing: h.missing,
      };
      if (!withProbe) return base;

      const pageId = (c.config as { pageId?: string } | null)?.pageId;
      const token = getSocialPageToken(c);
      if (!pageId || !token) {
        return {
          ...base,
          webhook: { subscribedFields: [], missingForComments: [], error: "Sin pageId o sin token" },
        };
      }

      const probe = await probePageSubscription(pageId, token);
      return {
        ...base,
        webhook: {
          subscribedFields: probe.subscribedFields,
          // Solo tiene sentido para Facebook: los comentarios de Instagram
          // llegan por el objeto `instagram` de la app, que se configura a
          // nivel aplicación y no se puede leer con un token de Página.
          missingForComments:
            c.provider === "MESSENGER" && !probe.error
              ? missingCommentFields(probe.subscribedFields)
              : [],
          error: probe.error,
        },
      };
    })
  );

  return NextResponse.json({ data });
}

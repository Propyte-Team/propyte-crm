// POST: alta conjunta «Meta DMs» — la cuenta de Messenger de una Página y, si se pide, la de
// Instagram vinculada a esa misma Página, en UNA petición y UNA transacción (2026-10-10).
//
// Por qué existe: las dos cuentas comparten Page ID, Page Access Token, App Secret, Verify
// Token y marca; con dos asistentes había que teclearlo todo dos veces, y si la segunda alta
// fallaba la marca quedaba a medias (Messenger sí, Instagram no) sin que nadie lo notara.
// Aquí o se crean las dos o ninguna.
//
// Antes de escribir nada se pregunta a Meta:
//  - de qué Página es el token (GET /me): si no es la del Page ID escrito, no se guarda —
//    un token de otra Página no falla al guardarlo, falla días después, en silencio, cuando
//    el bot intenta contestar;
//  - si se incluye Instagram, qué cuenta de IG tiene vinculada la Página: el igBusinessId
//    tiene que ser ese, porque es con el que el webhook decide a qué cuenta va cada DM.
// Después de crear, se suscribe la Página a los webhooks (misma lógica que «Suscribir
// página»). Si eso falla las cuentas se quedan: se informa y se reintenta con el botón.
//
// Nunca salen en la respuesta ni en un log el token ni el App Secret.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { writeCredentials } from "@/lib/intake/connectors";
import {
  buildMetaDmDrafts,
  findMetaDmConflicts,
  conflictMessage,
  noLinkedInstagramMessage,
  igMismatchMessage,
  type MetaDmProvider,
} from "@/lib/connectors/meta-dms";
import { metaDmsCreateSchema, firstIssueMessage } from "@/lib/validations/meta-dms";
import { connectorCredentialsSocialSchema, connectorConfigSocialSchema } from "@/lib/validations/rebuild-f1";
import { verifyPageToken, pageMismatchMessage, fetchLinkedInstagram, scrubToken } from "@/lib/messaging/page-token";
import { ensurePageSubscription } from "@/lib/messaging/ensure-page-subscription";

export const dynamic = "force-dynamic";
// Peor caso: verificar token (8 s) + Instagram vinculado (8 s) + leer, suscribir y confirmar
// la suscripción (3 × 8 s) = 40 s. Sin esto la plataforma corta antes y el admin ve un error
// aunque las cuentas sí se hayan creado.
export const maxDuration = 60;

// Mismos roles que /api/admin/connectors: quien puede crear una cuenta puede crear las dos.
const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

const PROVIDER_LABEL: Record<MetaDmProvider, string> = { MESSENGER: "Messenger", INSTAGRAM: "Instagram" };

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const parsed = metaDmsCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssueMessage(parsed.error) }, { status: 400 });
  const { name, brandId, includeInstagram, fields } = parsed.data;
  const { pageId, pageAccessToken: token } = fields;
  const igBusinessId = includeInstagram ? fields.igBusinessId ?? "" : "";

  if (includeInstagram && !igBusinessId) {
    return NextResponse.json(
      { error: "Falta el Instagram Business ID. Prueba la conexión para llenarlo solo, o desmarca «Incluir Instagram»." },
      { status: 400 }
    );
  }

  // Solo marcas vivas: una borrada o inventada dejaría las cuentas apuntando a una marca sin agente.
  if (typeof brandId === "string") {
    const brand = await prisma.brand.findFirst({ where: { id: brandId, deletedAt: null }, select: { id: true } });
    if (!brand) return NextResponse.json({ error: "Marca no encontrada" }, { status: 400 });
  }

  // Duplicados antes de llamar a Meta: es lo más barato y lo más probable (la marca ya tenía
  // su Messenger). Cualquier estado cuenta, incluida una pausada: solo las borradas no.
  const existing = await prisma.leadConnector.findMany({
    where: {
      provider: { in: includeInstagram ? ["MESSENGER", "INSTAGRAM"] : ["MESSENGER"] },
      deletedAt: null,
    },
    select: { id: true, name: true, provider: true, config: true },
  });
  const target = { pageId, includeInstagram, igBusinessId: igBusinessId || undefined };
  const conflicts = findMetaDmConflicts(existing, target);
  if (conflicts.length) {
    return NextResponse.json({ error: conflictMessage(conflicts, target) }, { status: 409 });
  }

  const check = await verifyPageToken(token);
  if (!check.ok) {
    return check.kind === "graph"
      ? NextResponse.json({ error: `Meta rechazó el token: ${check.error}` }, { status: 400 })
      : NextResponse.json({ error: `No se pudo verificar el token con Meta: ${check.error}` }, { status: 502 });
  }
  if (check.pageId !== pageId) {
    return NextResponse.json({ error: pageMismatchMessage(check, pageId) }, { status: 400 });
  }

  let instagram: { id: string; username: string } | null = null;
  if (includeInstagram) {
    const linked = await fetchLinkedInstagram(pageId, token);
    if (!linked.ok) {
      return linked.kind === "graph"
        ? NextResponse.json({ error: `Meta no dejó consultar el Instagram de la Página: ${linked.error}` }, { status: 400 })
        : NextResponse.json({ error: `No se pudo consultar el Instagram de la Página: ${linked.error}` }, { status: 502 });
    }
    if (!linked.instagram) {
      return NextResponse.json({ error: noLinkedInstagramMessage(check.pageName) }, { status: 400 });
    }
    if (linked.instagram.id !== igBusinessId) {
      return NextResponse.json({ error: igMismatchMessage(linked.instagram, igBusinessId, check.pageName) }, { status: 400 });
    }
    instagram = linked.instagram;
  }

  const drafts = buildMetaDmDrafts({
    name,
    includeInstagram,
    fields: { ...fields, igBusinessId } as Record<string, string>,
  });
  // Mismas reglas que el alta por proveedor (/api/admin/connectors): si el registro cambia y
  // un secreto deja de ir a credentials, esto lo frena en vez de guardarlo en claro en config.
  for (const d of drafts) {
    const creds = connectorCredentialsSocialSchema.safeParse(d.credentials);
    const cfg = connectorConfigSocialSchema.safeParse(d.config);
    if (!creds.success || !cfg.success || (d.provider === "INSTAGRAM" && !cfg.data.igBusinessId)) {
      return NextResponse.json({ error: `Datos incompletos para la cuenta de ${PROVIDER_LABEL[d.provider]}` }, { status: 400 });
    }
  }

  // Una sola transacción: o quedan las dos cuentas, o ninguna. Se crean ya activas porque
  // el token se acaba de comprobar contra la Página (en el alta por proveedor se crean en
  // pausa y el asistente las activa tras «Probar conexión»: aquí esa prueba la hizo el servidor).
  let created: Array<{ id: string; name: string; provider: string; status: string }>;
  try {
    created = await prisma.$transaction(
      drafts.map((d) =>
        prisma.leadConnector.create({
          data: {
            name: d.name,
            provider: d.provider,
            status: "ACTIVE",
            credentials: writeCredentials(d.credentials),
            config: d.config as never,
            fieldMap: {} as never,
            ...(brandId !== undefined ? { brandId } : {}),
          },
          select: { id: true, name: true, provider: true, status: true },
        })
      )
    );
  } catch (err) {
    // Solo el código: el error de Prisma puede traer los datos de la query.
    console.error("[meta-dms] no se pudieron crear las cuentas:", (err as { code?: string } | null)?.code ?? "sin código");
    return NextResponse.json({ error: "No se pudieron crear las cuentas; no se guardó ninguna." }, { status: 500 });
  }

  for (const c of created) {
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CREATE",
        entity: "LeadConnector",
        entityId: c.id,
        changes: { name: c.name, provider: c.provider, pageId, via: "meta-dms" },
      },
    }).catch(() => {});
  }

  // Sin la app instalada en la Página, Meta no manda nada de ella aunque las cuentas estén
  // perfectas (lo que le pasó a Yaxnáh). No se revierte el alta si falla: las cuentas están
  // bien y la suscripción se reintenta con «Suscribir página».
  let subscription:
    | { ok: true; changed: boolean; subscribedFields: string[]; missing: string[] }
    | { ok: false; error: string };
  try {
    const result = await ensurePageSubscription(pageId, token);
    subscription = result.ok
      ? { ok: true, changed: result.changed, subscribedFields: result.subscribedFields, missing: result.missing }
      : {
          ok: false,
          error: scrubToken(
            `${result.stage === "read" ? "No se pudo leer la Página" : "Meta no aceptó la suscripción"}: ${result.error}`,
            token
          ),
        };
  } catch (err) {
    subscription = { ok: false, error: scrubToken(err instanceof Error ? err.message : String(err), token) };
  }

  return NextResponse.json(
    {
      data: {
        connectors: created,
        page: { id: check.pageId, name: check.pageName },
        instagram,
        subscription,
      },
    },
    { status: 201 }
  );
}

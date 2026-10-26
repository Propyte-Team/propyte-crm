// Detalle de conversación + mensajes (polling con ?since=ISO) y acciones de hilo.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { canViewInboxContact } from "@/lib/inbox/scope";
import { getVisibleBrands } from "@/lib/brands/user-access";
import { CONTACT_BRAND_SELECT } from "@/lib/brands/visibility";
import { connectorBrandLabel } from "@/lib/inbox/connector-label";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const since = req.nextUrl.searchParams.get("since");

  const conversation = await prisma.conversation.findUnique({
    where: { id: params.id },
    include: {
      // brand (2026-10-09): la marca asignada a la cuenta etiqueta el hilo; sin ella, config.brand.
      // brandId (2026-10-12, entrega 3): marca de la cuenta del hilo para el badge del encabezado.
      connector: { select: { name: true, config: true, brandId: true, brand: { select: { name: true } } } },
      contact: {
        select: {
          id: true, firstName: true, lastName: true, phone: true, email: true,
          temperature: true, score: true, preferredLanguage: true, budgetMin: true,
          budgetMax: true, preferredZone: true, purchaseTimeline: true, whatsappOptOut: true,
          custom: true, assignedToId: true,
          // teamLeaderId lo pide el alcance del TEAM_LEADER; se quita del JSON más abajo.
          assignedTo: { select: { id: true, name: true, teamLeaderId: true } },
          // Marcas del contacto: las pide el filtro por marca (2026-10-12); no viajan al cliente.
          brands: CONTACT_BRAND_SELECT,
          deals: {
            where: { deletedAt: null, stage: { notIn: ["WON", "LOST"] } },
            select: { id: true, stage: true, estimatedValue: true, dealType: true },
            take: 3,
          },
        },
      },
      controlledBy: { select: { id: true, name: true } },
      messages: {
        where: since ? { createdAt: { gt: new Date(since) } } : undefined,
        orderBy: { createdAt: "asc" },
        take: 200,
      },
    },
  });
  if (!conversation) return NextResponse.json({ error: "No existe" }, { status: 404 });

  // Alcance idéntico al de la lista, al envío y a la asignación: los cuatro usan
  // @/lib/inbox/scope (canViewInboxContact ≡ inboxScopeWhere). 404 y no 403: la lista
  // tampoco le muestra este hilo a quien está fuera de su alcance, así que un 403
  // confirmaría por URL directa que el hilo existe a alguien que no debe saberlo — la
  // misma respuesta da hoy messages/route.ts (simetría real desde el 404 unificado).
  // Marcas (2026-10-12): un hilo de una marca que el usuario no ve es igual de inexistente.
  if (!canViewInboxContact(conversation.contact, session.user, await getVisibleBrands(session.user))) {
    return NextResponse.json({ error: "No existe" }, { status: 404 });
  }

  // Marcar leído al abrir (solo si no es polling incremental). El polling del hilo abierto también
  // pasa por aquí cada 5 s, así que un mensaje que llega mientras se ve el chat se apaga solo.
  // #928: `markedRead` le avisa al cliente que hubo cambio, para refrescar el badge del menú en el
  // momento; y `unreadCount` sale ya en 0 en vez del valor previo a la actualización.
  const markedRead = !since && conversation.unreadCount > 0;
  if (markedRead) {
    await prisma.conversation.update({
      where: { id: params.id },
      data: { unreadCount: 0 },
    });
    conversation.unreadCount = 0;
  }

  // Media del bucket privado → signed URLs de lectura (24h); URLs externas pasan tal cual
  const { signChatMediaUrls, isStoragePath } = await import("@/lib/storage/chat-media");
  const paths = conversation.messages.map((m) => m.mediaUrl).filter((u): u is string => !!u && isStoragePath(u));
  const signed = await signChatMediaUrls(paths);
  const messages = conversation.messages.map((m) => ({
    ...m,
    mediaUrl: m.mediaUrl ? (isStoragePath(m.mediaUrl) ? signed[m.mediaUrl] ?? null : m.mediaUrl) : null,
  }));

  // Cuenta/marca (config del conector es no-secreto) + avatar; custom no viaja al cliente
  const { connector, contact, ...rest } = conversation;
  const data = {
    ...rest,
    markedRead,
    messages,
    connector: connector
      ? { name: connector.name, brand: connectorBrandLabel(connector), brandId: connector.brandId ?? null }
      : null,
    contact: {
      ...contact,
      custom: undefined,
      brands: undefined,
      // teamLeaderId es dato interno de jerarquía (solo alimenta el alcance del TL):
      // se reconstruye assignedTo con lo que la UI sí usa, igual que se corta custom.
      assignedTo: contact.assignedTo ? { id: contact.assignedTo.id, name: contact.assignedTo.name } : null,
      avatarUrl: ((contact.custom as Record<string, unknown> | null)?.avatarUrl as string | undefined) ?? null,
    },
  };

  return NextResponse.json({ data });
}

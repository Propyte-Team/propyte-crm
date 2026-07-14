// Detalle de conversación + mensajes (polling con ?since=ISO) y acciones de hilo.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const since = req.nextUrl.searchParams.get("since");

  const conversation = await prisma.conversation.findUnique({
    where: { id: params.id },
    include: {
      connector: { select: { name: true, config: true } },
      contact: {
        select: {
          id: true, firstName: true, lastName: true, phone: true, email: true,
          temperature: true, score: true, preferredLanguage: true, budgetMin: true,
          budgetMax: true, preferredZone: true, purchaseTimeline: true, whatsappOptOut: true,
          custom: true,
          assignedTo: { select: { id: true, name: true } },
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

  // Marcar leído al abrir (solo si no es polling incremental)
  if (!since && conversation.unreadCount > 0) {
    await prisma.conversation.update({
      where: { id: params.id },
      data: { unreadCount: 0 },
    });
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
    messages,
    connector: connector
      ? { name: connector.name, brand: ((connector.config as Record<string, unknown> | null)?.brand as string | undefined) ?? null }
      : null,
    contact: {
      ...contact,
      custom: undefined,
      avatarUrl: ((contact.custom as Record<string, unknown> | null)?.avatarUrl as string | undefined) ?? null,
    },
  };

  return NextResponse.json({ data });
}

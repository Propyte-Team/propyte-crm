// Lista de conversaciones del inbox (Anexo B §I.6) — filtros: mine|bot|unassigned|unread.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import type { Prisma } from "@prisma/client";
import { inboxScopeWhere } from "@/lib/inbox/scope";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const filter = req.nextUrl.searchParams.get("filter") ?? "all";
  const search = req.nextUrl.searchParams.get("q")?.trim();

  const where: Prisma.ConversationWhereInput = { status: { not: "CLOSED" } };

  // El where.contact se COMPONE con AND — nunca sobreescribir: el search pisaba
  // el OR del aislamiento y un asesor buscando veía hilos ajenos (fuga, ago-2026).
  const contactConds: Prisma.ContactWhereInput[] = [];

  // Alcance por rol — definición única en @/lib/inbox/scope (misma regla que el detalle,
  // el envío y la asignación). undefined = ve todo, no hay condición que agregar.
  const alcance = inboxScopeWhere(session.user);
  if (alcance) contactConds.push(alcance);

  if (filter === "mine") {
    contactConds.push({ assignedToId: session.user.id });
  } else if (filter === "unassigned") {
    contactConds.push({ assignedToId: null });
  } else if (filter === "bot") {
    where.status = "BOT";
  } else if (filter === "human") {
    where.status = "HUMAN";
  } else if (filter === "unread") {
    where.unreadCount = { gt: 0 };
  }

  if (search) {
    contactConds.push({
      OR: [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ],
    });
  }

  if (contactConds.length > 0) where.contact = { AND: contactConds };

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 100,
    select: {
      id: true, status: true, botEnabled: true, unreadCount: true,
      lastMessageAt: true, aiSummary: true, channel: true,
      connector: { select: { name: true, config: true } },
      contact: {
        select: {
          id: true, firstName: true, lastName: true, phone: true, temperature: true,
          score: true, assignedToId: true, custom: true,
          assignedTo: { select: { id: true, name: true } },
        },
      },
      controlledBy: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true, sender: true } },
    },
  });

  // Cuenta/marca (config del conector es no-secreto) + avatar; custom no viaja al cliente
  const data = conversations.map(({ connector, contact, ...c }) => ({
    ...c,
    connector: connector
      ? { name: connector.name, brand: ((connector.config as Record<string, unknown> | null)?.brand as string | undefined) ?? null }
      : null,
    contact: {
      ...contact,
      custom: undefined,
      avatarUrl: ((contact.custom as Record<string, unknown> | null)?.avatarUrl as string | undefined) ?? null,
    },
  }));

  return NextResponse.json({ data });
}

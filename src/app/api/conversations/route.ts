// Lista de conversaciones del inbox (Anexo B §I.6) — filtros: mine|bot|unassigned|unread.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const MANAGER_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"];

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const filter = req.nextUrl.searchParams.get("filter") ?? "all";
  const search = req.nextUrl.searchParams.get("q")?.trim();

  const where: Prisma.ConversationWhereInput = { status: { not: "CLOSED" } };

  // Alcance por rol: asesores ven sus contactos + sin asignar; dirección ve todo
  if (!MANAGER_ROLES.includes(session.user.role)) {
    where.contact = {
      OR: [{ assignedToId: session.user.id }, { assignedToId: null }],
    };
  }

  if (filter === "mine") {
    where.contact = { assignedToId: session.user.id };
  } else if (filter === "bot") {
    where.status = "BOT";
  } else if (filter === "human") {
    where.status = "HUMAN";
  } else if (filter === "unread") {
    where.unreadCount = { gt: 0 };
  } else if (filter === "unassigned") {
    where.contact = { assignedToId: null };
  }

  if (search) {
    where.contact = {
      ...(where.contact as object ?? {}),
      OR: [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ],
    };
  }

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 100,
    select: {
      id: true, status: true, botEnabled: true, unreadCount: true,
      lastMessageAt: true, aiSummary: true, channel: true,
      contact: {
        select: {
          id: true, firstName: true, lastName: true, phone: true, temperature: true,
          score: true, assignedToId: true,
          assignedTo: { select: { id: true, name: true } },
        },
      },
      controlledBy: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true, sender: true } },
    },
  });

  return NextResponse.json({ data: conversations });
}

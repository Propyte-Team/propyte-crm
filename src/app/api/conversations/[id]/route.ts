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
      contact: {
        select: {
          id: true, firstName: true, lastName: true, phone: true, email: true,
          temperature: true, score: true, preferredLanguage: true, budgetMin: true,
          budgetMax: true, preferredZone: true, purchaseTimeline: true, whatsappOptOut: true,
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

  return NextResponse.json({ data: conversation });
}

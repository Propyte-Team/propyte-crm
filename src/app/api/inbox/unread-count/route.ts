// ============================================================
// API Route: /api/inbox/unread-count
// Conteo de conversaciones con mensajes sin leer, para pintar el
// badge de "Inbox" en el sidebar (#791: no había ningún aviso de
// mensajes pendientes fuera de la propia pestaña del Inbox).
//
// Usa la MISMA función de alcance que /api/conversations
// (@/lib/inbox/scope) para que un asesor no vea en el badge
// conversaciones que ni siquiera puede abrir. Es un endpoint aparte
// -en vez de reusar /api/conversations- porque ese devuelve hasta
// 100 conversaciones completas (contacto, último mensaje, etc.) y
// aquí solo hace falta un número; se sondea cada pocos segundos
// desde el sidebar, así que el costo por llamada importa.
// ============================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import type { Prisma } from "@prisma/client";
import { inboxScopeWhere } from "@/lib/inbox/scope";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const where: Prisma.ConversationWhereInput = {
    status: { not: "CLOSED" },
    unreadCount: { gt: 0 },
  };

  const alcance = inboxScopeWhere(session.user);
  if (alcance) where.contact = { AND: [alcance] };

  const count = await prisma.conversation.count({ where });

  return NextResponse.json({ count });
}

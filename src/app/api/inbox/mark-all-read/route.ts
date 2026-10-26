// ============================================================
// API Route: /api/inbox/mark-all-read (#928)
// POST - «Marcar todo como leído» del Inbox.
//
// Pone en 0 el unreadCount de TODAS las conversaciones que cuenta el badge del menú para este
// usuario: abiertas (no CLOSED), con no leídos y dentro de su alcance por rol y marca. La
// definición es la misma que la de /api/inbox/unread-count (@/lib/inbox/unread), así que después
// de esto el badge queda en 0. No amplía nada: es lo mismo que abrir uno por uno cada hilo que
// el usuario ya puede abrir.
// ============================================================

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { getVisibleBrands } from "@/lib/brands/user-access";
import { unreadInboxWhere } from "@/lib/inbox/unread";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const where = unreadInboxWhere(session.user, await getVisibleBrands(session.user));
    const res = await prisma.conversation.updateMany({ where, data: { unreadCount: 0 } });
    return NextResponse.json({ data: { updated: res.count } });
  } catch (error) {
    console.error("Error en /api/inbox/mark-all-read:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

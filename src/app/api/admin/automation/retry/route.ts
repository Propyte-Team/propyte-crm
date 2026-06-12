// Retry manual de una acción fallida en la cola (Fase 4, T4.1). Solo Dirección/Admin.
// Re-encola la acción (PENDING, runAfter=now, error limpiado) para el próximo tick del cron.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];
const schema = z.object({ id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const action = await prisma.actionQueue.findUnique({ where: { id: parsed.data.id } });
  if (!action) return NextResponse.json({ error: "Acción no encontrada" }, { status: 404 });
  if (action.status !== "FAILED") {
    return NextResponse.json({ error: "Solo se pueden reintentar acciones FAILED" }, { status: 409 });
  }

  await prisma.actionQueue.update({
    where: { id: action.id },
    data: { status: "PENDING", runAfter: new Date(), error: null, startedAt: null, finishedAt: null },
  });

  return NextResponse.json({ ok: true });
}

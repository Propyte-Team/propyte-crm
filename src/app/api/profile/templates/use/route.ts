// Marca uso de una plantilla (fire-and-forget desde el composer del inbox):
// incrementa usageCount → el dropdown se auto-ordena por uso (GET ya ordena así).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const useSchema = z.object({ id: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const parsed = useSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Solo plantillas visibles para el usuario (propias o globales)
  const { count } = await prisma.userTemplate.updateMany({
    where: { id: parsed.data.id, deletedAt: null, OR: [{ userId: session.user.id }, { userId: null }] },
    data: { usageCount: { increment: 1 } },
  });
  if (count === 0) return NextResponse.json({ error: "No existe" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

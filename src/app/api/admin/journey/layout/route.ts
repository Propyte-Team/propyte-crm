import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];
const posSchema = z.record(z.object({ x: z.number(), y: z.number() }));
const putSchema = z.object({ scope: z.string().min(1).max(200), positions: posSchema });

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const scope = new URL(req.url).searchParams.get("scope") || "general";
  const row = await prisma.journeyLayout.findUnique({ where: { id: scope } }).catch(() => null);
  return NextResponse.json({ positions: (row?.positions as unknown) ?? {} });
}

export async function PUT(req: Request) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { scope, positions } = parsed.data;
  await prisma.journeyLayout.upsert({
    where: { id: scope },
    create: { id: scope, positions: positions as object },
    update: { positions: positions as object },
  });
  return NextResponse.json({ ok: true });
}

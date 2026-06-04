import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";
import { generateToken, defaultExpiry } from "@/lib/intake/token";

const ADMIN = ["DIRECTOR", "GERENTE", "ADMIN"];

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ADMIN.includes(session.user.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const links = await prisma.intakeLink.findMany({
    where: { deletedAt: null },
    include: { _count: { select: { submissions: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ data: links });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ADMIN.includes(session.user.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.label || typeof body.label !== "string") {
    return NextResponse.json({ error: "label requerido" }, { status: 400 });
  }
  const noExpiry = body.noExpiry === true;
  const link = await prisma.intakeLink.create({
    data: {
      token: generateToken(),
      label: body.label.trim(),
      targetDevId: typeof body.targetDevId === "string" && body.targetDevId ? body.targetDevId : null,
      expiresAt: noExpiry ? null : defaultExpiry(new Date()),
      createdBy: session.user.id ?? session.user.email ?? "unknown",
    },
  });
  return NextResponse.json({ data: link }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";

const ADMIN = ["DIRECTOR", "GERENTE", "ADMIN"];

export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ADMIN.includes(session.user.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const link = await prisma.intakeLink.update({
    where: { id: params.id },
    data: { revokedAt: new Date() },
  });
  return NextResponse.json({ data: link });
}

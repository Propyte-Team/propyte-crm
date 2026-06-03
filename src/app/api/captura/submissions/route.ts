import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";

const ADMIN = ["DIRECTOR", "GERENTE", "ADMIN"];

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ADMIN.includes(session.user.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const status = new URL(request.url).searchParams.get("status") ?? "PENDING";
  const subs = await prisma.intakeSubmission.findMany({
    where: { status: status as "PENDING" | "APPROVED" | "REJECTED" },
    include: { link: { select: { label: true, targetDevId: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ data: subs });
}

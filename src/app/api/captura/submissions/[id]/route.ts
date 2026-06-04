import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";
import { intakePayloadSchema } from "@/lib/intake/schema";

const ADMIN = ["DIRECTOR", "GERENTE", "ADMIN"];

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ADMIN.includes(session.user.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.action) return NextResponse.json({ error: "action requerida" }, { status: 400 });

  if (body.action === "reject") {
    const sub = await prisma.intakeSubmission.update({
      where: { id: params.id },
      data: { status: "REJECTED", reviewNotes: typeof body.reviewNotes === "string" ? body.reviewNotes : null, reviewedBy: session.user.id ?? session.user.email ?? "unknown" },
    });
    return NextResponse.json({ data: sub });
  }

  if (body.action === "edit") {
    const parsed = intakePayloadSchema.safeParse(body.payload);
    if (!parsed.success) return NextResponse.json({ error: "Payload inválido", details: parsed.error.flatten() }, { status: 400 });
    const sub = await prisma.intakeSubmission.update({ where: { id: params.id }, data: { payload: parsed.data } });
    return NextResponse.json({ data: sub });
  }

  return NextResponse.json({ error: "action inválida" }, { status: 400 });
}

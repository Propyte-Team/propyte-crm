import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import prisma from "@/lib/db";
import { intakePayloadSchema } from "@/lib/intake/schema";
import { upsertDevelopment, insertTypologies, promoteQuarantineImages, attachDevelopmentImages } from "@/lib/intake/catalog-writer";

const ADMIN = ["DIRECTOR", "GERENTE", "ADMIN"];

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ADMIN.includes(session.user.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });

  const sub = await prisma.intakeSubmission.findUnique({ where: { id: params.id }, include: { link: true } });
  if (!sub) return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
  if (sub.status === "APPROVED" && sub.resultDevId) {
    return NextResponse.json({ success: true, devId: sub.resultDevId, alreadyApproved: true });
  }

  const parsed = intakePayloadSchema.safeParse(sub.payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const devId = await upsertDevelopment(parsed.data, sub.link.targetDevId);
    await insertTypologies(parsed.data, devId);
    if (sub.imageUrls.length) {
      const urls = await promoteQuarantineImages(sub.imageUrls, devId);
      await attachDevelopmentImages(devId, urls);
    }
    await prisma.intakeSubmission.update({
      where: { id: sub.id },
      data: { status: "APPROVED", resultDevId: devId, reviewedBy: session.user.id ?? session.user.email ?? "unknown" },
    });
    return NextResponse.json({ success: true, devId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

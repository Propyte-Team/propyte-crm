import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getUsableLink } from "@/lib/intake/get-usable-link";
import { intakePayloadSchema } from "@/lib/intake/schema";

const MAX_SUBMISSIONS_PER_LINK = 50; // tope anti-abuso

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const link = await getUsableLink(params.token);
  if (!link) return NextResponse.json({ error: "Link inválido o expirado" }, { status: 410 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  // Honeypot: si viene relleno, fingir éxito sin guardar.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ success: true });
  }

  const parsed = intakePayloadSchema.safeParse(body.payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const count = await prisma.intakeSubmission.count({ where: { linkId: link.id } });
  if (count >= MAX_SUBMISSIONS_PER_LINK) {
    return NextResponse.json({ error: "Este link alcanzó el máximo de envíos" }, { status: 429 });
  }

  const imageUrls: string[] = Array.isArray(body.imagePaths)
    ? body.imagePaths.filter((p: unknown) => typeof p === "string")
    : [];

  const submission = await prisma.intakeSubmission.create({
    data: { linkId: link.id, payload: parsed.data, imageUrls, status: "PENDING" },
  });
  return NextResponse.json({ success: true, id: submission.id }, { status: 201 });
}

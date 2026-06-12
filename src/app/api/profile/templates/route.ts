// Plantillas del usuario (Anexo B §J.2). GET incluye las globales (userId=null, solo lectura).
// POST crea personal; ADMIN/MARKETING pueden crear global con {global:true}.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { userTemplateSchema } from "@/lib/validations/rebuild-f1";
import { lintBrandVoice } from "@/lib/bot/brand-linter";

const BRAND_ROLES = ["ADMIN", "MARKETING", "DIRECTOR"];

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const templates = await prisma.userTemplate.findMany({
    where: { deletedAt: null, OR: [{ userId: session.user.id }, { userId: null }] },
    orderBy: [{ userId: { sort: "desc", nulls: "last" } }, { usageCount: "desc" }],
  });
  return NextResponse.json({
    data: templates.map((t) => ({ ...t, isGlobal: t.userId === null })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = userTemplateSchema.extend({ global: z.boolean().optional() }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { global: isGlobal, ...data } = parsed.data;
  if (isGlobal && !BRAND_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo marca puede crear plantillas globales" }, { status: 403 });
  }

  // Linter de marca: warning (no bloquea — la escribe un humano, §J.2)
  const lint = lintBrandVoice(data.body);

  const template = await prisma.userTemplate.create({
    data: { ...data, userId: isGlobal ? null : session.user.id },
  });
  return NextResponse.json(
    { data: template, brandWarnings: lint.ok ? [] : lint.violations },
    { status: 201 }
  );
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  const tpl = await prisma.userTemplate.findUnique({ where: { id } });
  if (!tpl) return NextResponse.json({ error: "No existe" }, { status: 404 });
  const canDelete =
    tpl.userId === session.user.id || (tpl.userId === null && BRAND_ROLES.includes(session.user.role));
  if (!canDelete) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  await prisma.userTemplate.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  return NextResponse.json({ ok: true });
}

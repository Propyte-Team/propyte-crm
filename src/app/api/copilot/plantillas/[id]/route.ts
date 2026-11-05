// #988 — PATCH /api/copilot/plantillas/:id — editar el texto de una plantilla de la cadencia.
// Solo dirección, gerencia, Marketing y Admin (lib/copilot/roles.ts).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { puedeEditarPlantillas } from "@/lib/copilot/roles";
import { esTablaSinMigrar } from "@/lib/copilot/sin-migrar";

const cuerpoSchema = z.object({
  asunto: z.string().max(300).nullable().optional(),
  cuerpo: z.string().trim().min(1, "El texto no puede quedar vacío").max(5000),
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!puedeEditarPlantillas(session.user.role)) {
    return NextResponse.json({ error: "Solo dirección, gerencia, Marketing o Admin editan las plantillas" }, { status: 403 });
  }
  const parsed = cuerpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  try {
    const existe = await prisma.copilotPlantilla.findUnique({ where: { id }, select: { id: true } });
    if (!existe) return NextResponse.json({ error: "La plantilla no existe" }, { status: 404 });
    const asunto = parsed.data.asunto === undefined ? undefined : parsed.data.asunto?.trim() || null;
    const p = await prisma.copilotPlantilla.update({
      where: { id },
      data: { cuerpo: parsed.data.cuerpo, ...(asunto !== undefined ? { asunto } : {}), updatedAt: new Date(), updatedById: session.user.id },
    });
    return NextResponse.json({ data: p });
  } catch (err) {
    if (esTablaSinMigrar(err)) return NextResponse.json({ error: "Copilot todavía no está instalado (falta la migración)" }, { status: 503 });
    console.error("[copilot] editar plantilla:", err);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
}

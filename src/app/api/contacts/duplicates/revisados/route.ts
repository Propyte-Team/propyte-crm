// POST /api/contacts/duplicates/revisados — "No es duplicado": el grupo deja de aparecer.
// Persistencia: SystemConfig (clave contacts.duplicados_revisados = lista de firmas de grupo).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { CLAVE_REVISADOS, firmaDeGrupo } from "../firma";

const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "DEVELOPER_EXT", "MANTENIMIENTO"];
const MAX_FIRMAS = 5000; // tope para que la fila no crezca sin límite

const schema = z.object({ ids: z.array(z.string().min(1)).min(2).max(50) });

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!FULL_ACCESS_ROLES.includes(session.user.role as string)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Indica al menos dos contactos del grupo" }, { status: 400 });

  const firma = firmaDeGrupo(parsed.data.ids);
  const fila = await prisma.systemConfig.findUnique({ where: { key: CLAVE_REVISADOS } });
  const actuales: string[] = Array.isArray(fila?.value) ? (fila!.value as string[]) : [];
  if (!actuales.includes(firma)) {
    const nuevas = [...actuales, firma].slice(-MAX_FIRMAS);
    await prisma.systemConfig.upsert({
      where: { key: CLAVE_REVISADOS },
      update: { value: nuevas },
      create: { key: CLAVE_REVISADOS, value: nuevas },
    });
    await prisma.auditLog.create({
      data: { userId: session.user.id, action: "UPDATE", entity: "DuplicadosRevisados", entityId: firma.slice(0, 120), changes: { ids: parsed.data.ids } },
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}

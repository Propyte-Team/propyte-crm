// POST /api/contacts/fusiones/deshacer { id } — revierte una fusión registrada (E7 #977).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { setChangeSource } from "@/lib/audit/change-context";
import { deshacerFusionTx, type TxDeshacer } from "@/lib/contacts/fusiones";

const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "DEVELOPER_EXT", "MANTENIMIENTO"];
const schema = z.object({ id: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!FULL_ACCESS_ROLES.includes(session.user.role as string)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Indica la fusión a deshacer" }, { status: 400 });

  try {
    const res = await prisma.$transaction(async (tx) => {
      await setChangeSource(tx, { source: "merge", actorId: session.user.id });
      return deshacerFusionTx(tx as unknown as TxDeshacer, parsed.data.id);
    });
    if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
    await prisma.auditLog.create({
      data: { userId: session.user.id, action: "UPDATE", entity: "ContactoFusionDeshecha", entityId: res.loserId, changes: { fusionId: parsed.data.id, survivorId: res.survivorId } },
    }).catch(() => {});
    return NextResponse.json({ data: res });
  } catch (e) {
    console.error("[POST /api/contacts/fusiones/deshacer]", e);
    return NextResponse.json({ error: "No se pudo deshacer la fusión. Revisa que no haya un dato único repetido e inténtalo de nuevo" }, { status: 500 });
  }
}

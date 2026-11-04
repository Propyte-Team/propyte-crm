// GET /api/contacts/fusiones — fusiones recientes con datos para deshacer (E7 #977).
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { CLAVE_FUSIONES, leerFusiones } from "@/lib/contacts/fusiones";

const FULL_ACCESS_ROLES = ["ADMIN", "DIRECTOR", "DEVELOPER_EXT", "MANTENIMIENTO"];

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!FULL_ACCESS_ROLES.includes(session.user.role as string)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const fila = await prisma.systemConfig.findUnique({ where: { key: CLAVE_FUSIONES } });
  const data = leerFusiones(fila?.value)
    .slice(0, 30)
    .map((r) => ({
      id: r.id, fecha: r.fecha, survivorId: r.survivorId, loserId: r.loserId,
      survivorNombre: r.survivorNombre, loserNombre: r.loserNombre, deshechaEn: r.deshechaEn ?? null,
    }));
  return NextResponse.json({ data });
}

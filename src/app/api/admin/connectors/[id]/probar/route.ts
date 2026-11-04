// POST: «Probar» una cuenta ya conectada (E6). Hace UNA llamada de lectura al proveedor con las
// credenciales guardadas (lib/connectors/probar). Si falla, sube errorCount y guarda lastError para
// que el semáforo de Conexiones lo refleje; si funciona, no toca nada del conector.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { probarConector } from "@/lib/connectors/probar";

export const dynamic = "force-dynamic";

// Mismos roles que el resto de /api/admin/connectors.
const ALLOWED_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"];

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession();
  if (!session?.user || !ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ ok: false, detalle: "No autorizado" }, { status: 403 });
  }

  const connector = await prisma.leadConnector.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { id: true, provider: true, config: true, credentials: true },
  });
  if (!connector) return NextResponse.json({ ok: false, detalle: "Cuenta no encontrada" }, { status: 404 });

  const resultado = await probarConector(connector);

  if (!resultado.ok && resultado.error) {
    // Best-effort: registrar el fallo no debe impedir devolver el resultado de la prueba.
    await prisma.leadConnector
      .update({
        where: { id: connector.id },
        data: { errorCount: { increment: 1 }, lastError: resultado.error.slice(0, 1000) },
      })
      .catch((err: unknown) => console.error("[connectors] no se pudo registrar el fallo de la prueba:", err));
  }

  // `error` (texto crudo del proveedor) viaja solo si falló, para «Detalle técnico».
  return NextResponse.json(resultado, { status: resultado.ok ? 200 : 422 });
}

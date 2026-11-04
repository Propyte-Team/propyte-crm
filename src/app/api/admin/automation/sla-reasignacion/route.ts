// Configuración de la reasignación por falta de primer contacto (Configuración → Flujos de
// trabajo y SLA). Vive en SystemConfig para no necesitar migración. Ver
// lib/workflows/sla-reasignacion-model.ts.
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import {
  CLAVE_REASIGNACION,
  configReasignacionSchema,
  leerConfigReasignacion,
  siguienteConfig,
} from "@/lib/workflows/sla-reasignacion-model";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const fila = await prisma.systemConfig.findUnique({ where: { key: CLAVE_REASIGNACION } });
  return NextResponse.json({ data: leerConfigReasignacion(fila?.value) });
}

export async function PUT(req: Request) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Solo Dirección/Admin" }, { status: 403 });
  }
  const parsed = configReasignacionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const fila = await prisma.systemConfig.findUnique({ where: { key: CLAVE_REASIGNACION } });
  const anterior = leerConfigReasignacion(fila?.value);
  const nueva = siguienteConfig(anterior, parsed.data, new Date());

  await prisma.systemConfig.upsert({
    where: { key: CLAVE_REASIGNACION },
    create: { key: CLAVE_REASIGNACION, value: nueva },
    update: { value: nueva },
  });
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "SystemConfig",
      entityId: CLAVE_REASIGNACION,
      changes: { antes: anterior, despues: nueva },
    },
  });
  return NextResponse.json({ data: nueva });
}

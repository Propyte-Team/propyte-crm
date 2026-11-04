// Datos crudos para el resumen "¿Quién contesta?" (solo lectura). El cálculo de la precedencia
// (marca -> agente -> general) vive en src/lib/bot/quien-contesta.ts; aquí solo se junta lo que
// necesita. Mismos roles que las marcas del agente (lectura).
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { canReadBrands } from "@/lib/brands/roles";
import { getBotConfig } from "@/lib/bot/config";

// Cuentas por las que el bot puede contestar mensajes directos.
const PROVEEDORES_MENSAJERIA = ["WHATSAPP", "INSTAGRAM", "MESSENGER"] as const;

export async function GET() {
  const session = await getServerSession();
  if (!session?.user || !canReadBrands(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  try {
    const [config, agentes, marcas, cuentas, playbooks] = await Promise.all([
      getBotConfig(),
      prisma.botAgentProfile.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, contactTypes: true, tonePreset: true, playbookId: true, isActive: true, priority: true },
        orderBy: { priority: "asc" },
      }),
      prisma.brand
        .findMany({
          where: { deletedAt: null },
          select: { id: true, name: true, isDefault: true, botEnabled: true, tonePreset: true, playbookId: true },
        })
        .catch(() => []), // antes de la migración de marcas la tabla no existe
      prisma.leadConnector.findMany({
        where: { deletedAt: null, provider: { in: [...PROVEEDORES_MENSAJERIA] } },
        select: { id: true, name: true, provider: true, brandId: true, scope: true },
        orderBy: { name: "asc" },
      }),
      prisma.botPlaybook.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    ]);
    return NextResponse.json({
      botConfig: {
        botEnabled: config.botEnabled,
        tonePreset: config.tonePreset,
        autonomyLevel: config.autonomyLevel,
        activePlaybookId: config.activePlaybookId,
      },
      agentes,
      marcas,
      cuentas,
      playbooks,
    });
  } catch (err) {
    console.error("[bot/resumen] GET:", err);
    return NextResponse.json({ error: "No se pudo cargar el resumen del bot" }, { status: 500 });
  }
}

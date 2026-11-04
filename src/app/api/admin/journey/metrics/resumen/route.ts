import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { armarResumenReglas } from "@/lib/journey/resumen-reglas";
import { cutoffFromWindow, windowSchema } from "../route-helpers";

const MANAGE_ROLES = ["ADMIN", "DIRECTOR"];

// Métricas de TODAS las reglas con una sola consulta agregada (groupBy ruleId + status).
export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user || !MANAGE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const parsed = windowSchema.safeParse(new URL(req.url).searchParams.get("window") ?? "30");
  if (!parsed.success) return NextResponse.json({ error: "Ventana no válida" }, { status: 400 });
  const cutoff = cutoffFromWindow(parsed.data, Date.now());

  const [grupos, reglas] = await Promise.all([
    prisma.actionQueue.groupBy({
      by: ["ruleId", "status"],
      where: { ruleId: { not: null }, ...(cutoff ? { createdAt: { gte: cutoff } } : {}) },
      _count: { _all: true },
    }),
    prisma.automationRule.findMany({ where: { deletedAt: null }, select: { id: true, name: true, isActive: true } }),
  ]);
  const filas = armarResumenReglas(
    grupos.map((g) => ({ ruleId: g.ruleId, status: g.status, n: g._count._all })),
    reglas,
  );
  return NextResponse.json({ window: parsed.data, reglas: filas });
}

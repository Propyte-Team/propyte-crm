// Catálogo de unidades del Hub (read-only, SOT — Fase 1).
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { listHubUnits } from "@/lib/hub/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const developmentId = sp.get("developmentId") || undefined;
  const units = await listHubUnits({
    developmentId,
    search: sp.get("search") || undefined,
    onlyAvailable: sp.get("onlyAvailable") === "true" || undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  });

  // Forma compatible con el selector del deal form (id, unitNumber, unitType, price, status).
  const data = units.map((u) => ({
    id: u.id,
    unitNumber: u.numero ?? u.titulo ?? "s/n",
    unitType: u.tipo ?? u.tipologia ?? "",
    price: u.precioMxn ?? u.precioUsd ?? 0,
    moneda: u.moneda,
    status: u.status,
    recamaras: u.recamaras,
    banos: u.banos,
    m2: u.m2Construccion ?? u.m2Total,
    source: "hub" as const,
  }));
  return NextResponse.json({ data, source: "hub" });
}

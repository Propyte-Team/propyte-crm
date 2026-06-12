// Catálogo de desarrollos del Hub (read-only, SOT del inventario — Fase 1).
// El CRM no posee inventario: esto proyecta real_estate_hub vía el cliente Hub.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { listHubDevelopments } from "@/lib/hub/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const devs = await listHubDevelopments({
    search: sp.get("search") || undefined,
    zone: sp.get("zone") || undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  });

  // Forma compatible con el selector del deal form (id, name) + extras del Hub.
  const data = devs.map((d) => ({
    id: d.id,
    name: d.nombre,
    zona: d.zona,
    status: d.status,
    precioMin: d.precioMin,
    precioMax: d.precioMax,
    moneda: d.moneda,
    source: "hub" as const,
  }));
  return NextResponse.json({ data, source: "hub" });
}

// Buscador de desarrollos PUBLICADOS del Hub para armar la lista de una marca (2026-10-09).
// Reutiliza listPublishedDevelopments (mismo gate que propyte.com), así que solo aparece lo que el
// público ya puede ver; el CRM no es dueño de ese inventario, solo lo consulta.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { canReadBrands } from "@/lib/brands/roles";
import { listPublishedDevelopments } from "@/lib/hub/catalog";

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !canReadBrands(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // q vacío = sin filtro de texto; recortado para no mandar al Hub un texto absurdo.
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const { data, error } = await listPublishedDevelopments({ search: q || undefined, limit: 20 });
  if (error) return NextResponse.json({ error }, { status: 502 });

  return NextResponse.json({
    data: data.map((d) => ({ id: d.id, name: d.name, city: d.city ?? null })),
  });
}

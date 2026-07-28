// Buscador typeahead de records para el picker de relaciones (speckit §4.3).
// Soporta núcleo (contact/deal/user), externos del Hub (read-only) y custom records.
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { findMatchingDevelopments } from "@/lib/bot/hub-catalog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const object = req.nextUrl.searchParams.get("object") ?? "";
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!object || q.length < 2) return NextResponse.json({ data: [] });

  let results: Array<{ id: string; name: string; meta?: string }> = [];

  if (object === "contact") {
    const rows = await prisma.contact.findMany({
      where: {
        deletedAt: null,
        mergedIntoId: null,
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, phone: true },
      take: 10,
    });
    results = rows.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}`, meta: r.phone }));
  } else if (object === "deal") {
    const rows = await prisma.deal.findMany({
      where: {
        deletedAt: null,
        contact: {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
          ],
        },
      },
      select: { id: true, stage: true, estimatedValue: true, contact: { select: { firstName: true, lastName: true } } },
      take: 10,
    });
    results = rows.map((r) => ({
      id: r.id,
      name: `${r.contact.firstName} ${r.contact.lastName}`,
      meta: `${r.stage} · $${Number(r.estimatedValue).toLocaleString("es-MX")}`,
    }));
  } else if (object === "user") {
    const rows = await prisma.user.findMany({
      where: { isActive: true, deletedAt: null, name: { contains: q, mode: "insensitive" } },
      select: { id: true, name: true, role: true },
      take: 10,
    });
    results = rows.map((r) => ({ id: r.id, name: r.name, meta: r.role }));
  } else if (object === "hub_development") {
    // Objeto EXTERNO (Hub, read-only — OQ5). Fallo de catálogo ≠ catálogo vacío: si la
    // consulta al Hub falló, respondemos 503 en vez de fingir que no hay desarrollos.
    const { data: devs, error } = await findMatchingDevelopments({ zone: q, limit: 10 });
    if (error) return NextResponse.json({ error }, { status: 503 });
    results = devs.map((d) => ({
      id: d.id,
      name: d.nombre,
      meta: d.precio_min ? `desde $${Math.round(d.precio_min).toLocaleString("es-MX")}` : undefined,
    }));
  } else {
    const rows = await prisma.customRecord.findMany({
      where: { objectApiName: object, deletedAt: null, recordName: { contains: q, mode: "insensitive" } },
      select: { id: true, recordName: true },
      take: 10,
    });
    results = rows.map((r) => ({ id: r.id, name: r.recordName }));
  }

  return NextResponse.json({ data: results });
}

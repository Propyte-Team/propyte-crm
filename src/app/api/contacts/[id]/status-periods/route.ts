// ============================================================
// API Route: /api/contacts/[id]/status-periods
// Cuánto tiempo pasó el contacto en cada contactStatus (períodos con duración).
// GET - Lee RecordFieldChange (field='contactStatus') + degrada si la tabla no existe.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { getContactAccessInfo } from "@/server/contacts";
import { computeStatusPeriods, type StatusChangeInput } from "@/lib/timeline/status-periods";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const access = await getContactAccessInfo(params.id, session as any);
    if (!access.ok) {
      return NextResponse.json(
        { error: access.reason === "not_found" ? "Contacto no encontrado" : "No tienes acceso a este contacto" },
        { status: access.reason === "not_found" ? 404 : 403 }
      );
    }
    const contact = access.contact;

    let available = true;
    let changes: StatusChangeInput[] = [];
    try {
      changes = await prisma.recordFieldChange.findMany({
        where: { entityType: "contact", entityId: contact.id, field: "contactStatus" },
        select: { oldValue: true, newValue: true, changedAt: true },
        orderBy: { changedAt: "asc" },
      });
    } catch {
      // La migración de record_field_changes aún no se aplicó en esta BD: la UI oculta el bloque.
      available = false;
    }

    const periods = available ? computeStatusPeriods(changes, contact.createdAt, contact.contactStatus) : [];

    return NextResponse.json({ periods, available });
  } catch (error) {
    console.error("Error al calcular períodos de estado del contacto:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

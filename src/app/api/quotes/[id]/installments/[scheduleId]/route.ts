// ============================================================
// API Route: /api/quotes/[id]/installments/[scheduleId]
// PATCH - Actualiza estado de parcialidad
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { updateInstallment } from "@/server/quotes";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; scheduleId: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const result = await updateInstallment(params.scheduleId, body);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.schedule });
  } catch (error) {
    console.error("[PATCH /api/quotes/[id]/installments/[scheduleId]]", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

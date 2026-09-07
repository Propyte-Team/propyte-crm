// ============================================================
// API Route: /api/quotes/[id]/installments/[scheduleId]
// PATCH - Actualiza estado de parcialidad
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { updateInstallment } from "@/server/quotes";
import { FUERA_DE_ALCANCE } from "@/lib/rbac/deal-access";

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
      return NextResponse.json(
        { error: result.error },
        // #711: fuera de alcance es 404, no 403: un 403 confirma que el id existe.
        { status: result.error === FUERA_DE_ALCANCE ? 404 : 400 },
      );
    }

    return NextResponse.json({ data: result.schedule });
  } catch (error) {
    if (error instanceof Error && error.message === FUERA_DE_ALCANCE) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[PATCH /api/quotes/[id]/installments/[scheduleId]]", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

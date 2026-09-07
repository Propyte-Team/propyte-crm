// ============================================================
// API Route: /api/quotes/[id]/plan
// POST - Crea PaymentPlan + PaymentSchedule[]
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { createPaymentPlan } from "@/server/quotes";
import { FUERA_DE_ALCANCE } from "@/lib/rbac/deal-access";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Las cotas viven en paymentPlanSchema (lib/validations/quote.ts) y las aplica
    // createPaymentPlan: una sola fuente de verdad en vez de dos juegos de reglas.
    const body = await request.json();
    const result = await createPaymentPlan(params.id, body);

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        // #711: fuera de alcance es 404, no 403: un 403 confirma que el id existe.
        { status: result.error === FUERA_DE_ALCANCE ? 404 : 400 },
      );
    }

    return NextResponse.json({ data: result.plan }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === FUERA_DE_ALCANCE) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("[POST /api/quotes/[id]/plan]", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

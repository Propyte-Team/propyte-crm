// ============================================================
// API Route: /api/quotes/[id]/plan
// POST - Crea PaymentPlan + PaymentSchedule[]
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { createPaymentPlan } from "@/server/quotes";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { downPaymentPct, monthsCount, deliveryPaymentPct, startDate } = body;

    if (downPaymentPct === undefined || downPaymentPct < 0 || downPaymentPct > 100) {
      return NextResponse.json(
        { error: "downPaymentPct debe estar entre 0 y 100" },
        { status: 400 }
      );
    }

    const result = await createPaymentPlan(params.id, {
      downPaymentPct: Number(downPaymentPct),
      monthsCount: Number(monthsCount ?? 0),
      deliveryPaymentPct: deliveryPaymentPct ? Number(deliveryPaymentPct) : 0,
      startDate: startDate ? new Date(startDate) : undefined,
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.plan }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/quotes/[id]/plan]", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

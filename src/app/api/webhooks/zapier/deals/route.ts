// Webhook entrante de Zapier para crear deals
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const apiKey = await authenticateApiKey(req);
  if (!apiKey) {
    return NextResponse.json({ error: "API key inválida" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.contactId || !body.assignedToId || !body.dealType || !body.estimatedValue) {
      return NextResponse.json(
        { error: "contactId, assignedToId, dealType y estimatedValue son requeridos" },
        { status: 400 }
      );
    }

    const deal = await prisma.deal.create({
      data: {
        contactId: body.contactId,
        assignedToId: body.assignedToId,
        developmentId: body.developmentId || null,
        unitId: body.unitId || null,
        stage: body.stage || "NEW_LEAD",
        dealType: body.dealType,
        estimatedValue: body.estimatedValue,
        currency: body.currency || "MXN",
        probability: body.probability || 5,
        expectedCloseDate: body.expectedCloseDate
          ? new Date(body.expectedCloseDate)
          : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 días default
        leadSourceAtDeal: body.leadSourceAtDeal || "OTRO",
      },
    });

    return NextResponse.json({ id: deal.id, created: true }, { status: 201 });
  } catch (error) {
    console.error("Error creando deal via Zapier:", error);
    return NextResponse.json(
      { error: "Error al crear deal" },
      { status: 500 }
    );
  }
}

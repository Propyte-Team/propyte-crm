// Webhook entrante de Zapier para crear deals
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { prisma } from "@/lib/db";
import { parseDueDate } from "@/lib/due-date";

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

    // Sin zona, se interpreta como hora de pared de Cancún — igual que el
    // resto de las rutas de deals y de actividades. Antes de este fix,
    // `new Date(body.expectedCloseDate)` a secas con una fecha sin hora corría
    // el cierre un día antes en Cancún, y una fecha de calendario imposible
    // producía un Invalid Date que Prisma rechazaba con un 500 opaco. Ahora
    // se valida aquí y se responde 400 con un mensaje útil.
    let expectedCloseDate: Date;
    if (body.expectedCloseDate) {
      const parsed = parseDueDate(body.expectedCloseDate);
      if (!parsed) {
        return NextResponse.json(
          {
            error: `expectedCloseDate inválido: "${body.expectedCloseDate}". Usa "YYYY-MM-DD" o "YYYY-MM-DDTHH:mm[:ss]" (opcionalmente con zona, ej. "Z" o "-05:00").`,
          },
          { status: 400 },
        );
      }
      expectedCloseDate = parsed;
    } else {
      expectedCloseDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 días default
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
        expectedCloseDate,
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

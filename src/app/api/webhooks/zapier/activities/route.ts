// Webhook entrante de Zapier para crear actividades
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

    if (!body.contactId || !body.userId || !body.activityType || !body.subject) {
      return NextResponse.json(
        { error: "contactId, userId, activityType y subject son requeridos" },
        { status: 400 }
      );
    }

    // Sin zona, se interpreta como hora de pared de Cancún — igual que el
    // resto de las rutas de actividades. Un `new Date(body.dueDate)` a secas
    // aquí guardaría basura silenciosa (Invalid Date) si Zapier manda un
    // datetime sin offset o una fecha de calendario imposible.
    let dueDate: Date | null = null;
    if (body.dueDate) {
      dueDate = parseDueDate(body.dueDate);
      if (!dueDate) {
        return NextResponse.json({ error: "dueDate inválido" }, { status: 400 });
      }
    }

    const activity = await prisma.activity.create({
      data: {
        contactId: body.contactId,
        userId: body.userId,
        dealId: body.dealId || null,
        activityType: body.activityType,
        subject: body.subject,
        description: body.description || null,
        dueDate,
        status: body.status || "PENDIENTE",
      },
    });

    return NextResponse.json({ id: activity.id, created: true }, { status: 201 });
  } catch (error) {
    console.error("Error creando actividad via Zapier:", error);
    return NextResponse.json(
      { error: "Error al crear actividad" },
      { status: 500 }
    );
  }
}

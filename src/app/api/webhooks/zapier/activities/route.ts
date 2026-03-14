// Webhook entrante de Zapier para crear actividades
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

    if (!body.contactId || !body.userId || !body.activityType || !body.subject) {
      return NextResponse.json(
        { error: "contactId, userId, activityType y subject son requeridos" },
        { status: 400 }
      );
    }

    const activity = await prisma.activity.create({
      data: {
        contactId: body.contactId,
        userId: body.userId,
        dealId: body.dealId || null,
        activityType: body.activityType,
        subject: body.subject,
        description: body.description || null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
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

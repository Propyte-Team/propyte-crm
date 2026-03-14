// Webhook entrante de Zapier para crear/actualizar contactos
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

    const contact = await prisma.contact.create({
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email || null,
        phone: body.phone,
        secondaryPhone: body.secondaryPhone || null,
        contactType: body.contactType || "LEAD",
        leadSource: body.leadSource || "OTRO",
        leadSourceDetail: body.leadSourceDetail || null,
        residenceCity: body.residenceCity || null,
        residenceCountry: body.residenceCountry || null,
        temperature: body.temperature || "COLD",
        assignedToId: body.assignedToId || null,
        tags: body.tags || [],
      },
    });

    return NextResponse.json({ id: contact.id, created: true }, { status: 201 });
  } catch (error) {
    console.error("Error creando contacto via Zapier:", error);
    return NextResponse.json(
      { error: "Error al crear contacto" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const apiKey = await authenticateApiKey(req);
  if (!apiKey) {
    return NextResponse.json({ error: "API key inválida" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.id) {
      return NextResponse.json({ error: "id es requerido" }, { status: 400 });
    }

    const { id, ...data } = body;

    const contact = await prisma.contact.update({
      where: { id },
      data,
    });

    return NextResponse.json({ id: contact.id, updated: true });
  } catch (error) {
    console.error("Error actualizando contacto via Zapier:", error);
    return NextResponse.json(
      { error: "Error al actualizar contacto" },
      { status: 500 }
    );
  }
}

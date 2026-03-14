// Webhook entrante de Zapier para crear/actualizar contactos
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { prisma } from "@/lib/db";
import { z } from "zod";

const zapierContactUpdateSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().min(8).max(20).optional(),
  secondaryPhone: z.string().min(8).max(20).optional().nullable(),
  contactType: z.enum(["LEAD", "CLIENT", "INVESTOR", "REFERRAL"]).optional(),
  leadSource: z.string().max(50).optional(),
  leadSourceDetail: z.string().max(200).optional().nullable(),
  residenceCity: z.string().max(100).optional().nullable(),
  residenceCountry: z.string().max(100).optional().nullable(),
  temperature: z.enum(["COLD", "WARM", "HOT"]).optional(),
  assignedToId: z.string().uuid().optional().nullable(),
  tags: z.array(z.string()).optional(),
}).strict();

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

    const parsed = zapierContactUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { id, ...fields } = parsed.data;

    // Transformar nulls a formato Prisma para campos relacionales
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        data[key] = value;
      }
    }

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

// Webhook entrante de Zapier para crear/actualizar contactos
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { ContactType, LeadSource, LeadTemperature } from "@prisma/client";
import { withChangeSource } from "@/lib/audit/change-context";

// Auditoría 2026-09-10: el PUT de abajo SÍ validaba con zod estricto; el POST metía
// `body.*` crudo en `prisma.contact.create`. Consecuencias medidas sobre el código:
//
//   · Un `firstName` numérico, un objeto en `tags` o un `assignedToId` que no es un uuid
//     llegaban a Prisma y salían como 500 «Error al crear contacto», sin decir qué campo.
//   · `contactType` y `temperature` fuera del enum: mismo 500 opaco.
//   · Sin `.strict()`, un campo mal escrito (`firstname`, `phoneNumber`) se ignoraba en
//     silencio y el contacto se creaba a medias — el peor de los dos fallos, porque
//     devuelve 201 y nadie va a mirar.
//
// El esquema de creación comparte forma con el de actualización, pero aquí los tres
// campos que el CRM necesita para dar de alta a alguien son OBLIGATORIOS.
const zapierContactCreateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(8).max(20),
    email: z.string().email().optional().nullable(),
    secondaryPhone: z.string().trim().min(8).max(20).optional().nullable(),
    contactType: z.nativeEnum(ContactType).optional(),
    leadSource: z.nativeEnum(LeadSource).optional(),
    leadSourceDetail: z.string().max(200).optional().nullable(),
    residenceCity: z.string().max(100).optional().nullable(),
    residenceCountry: z.string().max(100).optional().nullable(),
    temperature: z.nativeEnum(LeadTemperature).optional(),
    assignedToId: z.string().uuid().optional().nullable(),
    tags: z.array(z.string().max(50)).max(30).optional(),
  })
  .strict();

const zapierContactUpdateSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().min(8).max(20).optional(),
  secondaryPhone: z.string().min(8).max(20).optional().nullable(),
  // 🚨 Auditoría 2026-09-10: aquí decía `z.enum(["LEAD","CLIENT","INVESTOR","REFERRAL"])`
  // y `temperature: z.enum(["COLD","WARM","HOT"])`. NINGUNO de esos tres valores de
  // contactType existe en el enum de la base, que es LEAD · PROSPECTO · CLIENTE ·
  // INVERSIONISTA · BROKER_EXTERNO · REFERIDO · EMPLEO · COMPRADOR · REFERIDOR. Sólo
  // coincidía "LEAD". O sea que este PUT llevaba tiempo:
  //
  //   · rechazando con 400 los valores VÁLIDOS (CLIENTE, PROSPECTO, COMPRADOR…), y
  //   · aceptando CLIENT / INVESTOR / REFERRAL para que Prisma los rechazara después con
  //     un 500 opaco.
  //
  // Nadie lo notó porque el `data` se armaba como `Record<string, unknown>` y TypeScript
  // no podía cruzarlo con el enum. Se descubrió al tipar el POST de arriba.
  //
  // Ahora los tres salen de `z.nativeEnum` sobre el enum de Prisma: si el schema cambia,
  // esto cambia con él y no hay una segunda lista que mantener a mano.
  contactType: z.nativeEnum(ContactType).optional(),
  leadSource: z.nativeEnum(LeadSource).optional(),
  leadSourceDetail: z.string().max(200).optional().nullable(),
  residenceCity: z.string().max(100).optional().nullable(),
  residenceCountry: z.string().max(100).optional().nullable(),
  temperature: z.nativeEnum(LeadTemperature).optional(),
  assignedToId: z.string().uuid().optional().nullable(),
  tags: z.array(z.string()).optional(),
}).strict();

export async function POST(req: NextRequest) {
  const apiKey = await authenticateApiKey(req);
  if (!apiKey) {
    return NextResponse.json({ error: "API key inválida" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);

    const parsed = zapierContactCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const d = parsed.data;

    const contact = await prisma.contact.create({
      data: {
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email || null,
        phone: d.phone,
        secondaryPhone: d.secondaryPhone || null,
        contactType: d.contactType ?? "LEAD",
        leadSource: d.leadSource || "OTRO",
        leadSourceDetail: d.leadSourceDetail || null,
        residenceCity: d.residenceCity || null,
        residenceCountry: d.residenceCountry || null,
        temperature: d.temperature ?? "COLD",
        assignedToId: d.assignedToId || null,
        tags: d.tags ?? [],
      },
    });

    // El evento a Meta CAPI se retiró junto con lib/meta (T3.4b); si se
    // necesita atribución server-side, reimplementar en el Hub.
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

    const contact = await withChangeSource(
      { source: "zapier" },
      (tx) => tx.contact.update({ where: { id }, data })
    );

    return NextResponse.json({ id: contact.id, updated: true });
  } catch (error) {
    console.error("Error actualizando contacto via Zapier:", error);
    return NextResponse.json(
      { error: "Error al actualizar contacto" },
      { status: 500 }
    );
  }
}

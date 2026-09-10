// Webhook entrante de Zapier para crear deals
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { prisma } from "@/lib/db";
import { parseDueDate } from "@/lib/due-date";

// Auditoría 2026-09-10: este POST validaba la PRESENCIA de cuatro campos y nada más; el
// resto entraba crudo en `prisma.deal.create`. Tres fallos concretos que esto cierra:
//
//  1. `probability: body.probability || 5` — un 0 legítimo («no le doy ninguna
//     probabilidad a este negocio») se guardaba como 5. Es el clásico de `||` con un
//     número: 0 es falsy. Ahora `?? 5`, y con el rango validado.
//  2. `estimatedValue` sin validar: una cadena, un negativo o un objeto llegaban al
//     Decimal(14,2) de Prisma y salían como 500 opaco en vez de 400.
//  3. `contactId`/`assignedToId` sin comprobar forma: un id que no es uuid daba el mismo
//     500. Y `dealType`/`stage`/`currency` fuera de su enum, otro.
//
// `.strict()` para que un campo mal escrito sea un 400 y no un negocio creado a medias.
const zapierDealCreateSchema = z
  .object({
    contactId: z.string().uuid(),
    assignedToId: z.string().uuid(),
    dealType: z.enum([
      "NATIVA_CONTADO",
      "NATIVA_FINANCIAMIENTO",
      "MACROLOTE",
      "CORRETAJE",
      "MASTERBROKER",
    ]),
    // Decimal(14,2) en la base: hasta 12 enteros. El tope evita el overflow silencioso.
    estimatedValue: z.number().positive().max(999_999_999_999),
    developmentId: z.string().uuid().optional().nullable(),
    unitId: z.string().uuid().optional().nullable(),
    stage: z
      .enum([
        "NEW_LEAD",
        "CONTACTED",
        "DISCOVERY_DONE",
        "MEETING_SCHEDULED",
        "MEETING_COMPLETED",
        "PROPOSAL_SENT",
        "NEGOTIATION",
        "RESERVED",
        "CONTRACT_SIGNED",
        "CLOSING",
        "WON",
        "LOST",
        "FROZEN",
      ])
      .optional(),
    currency: z.enum(["MXN", "USD"]).optional(),
    probability: z.number().int().min(0).max(100).optional(),
    expectedCloseDate: z.string().optional(),
    leadSourceAtDeal: z.string().max(50).optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const apiKey = await authenticateApiKey(req);
  if (!apiKey) {
    return NextResponse.json({ error: "API key inválida" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);

    const parsed = zapierDealCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const d = parsed.data;

    // Sin zona, se interpreta como hora de pared de Cancún — igual que el
    // resto de las rutas de deals y de actividades. Antes de este fix,
    // `new Date(body.expectedCloseDate)` a secas con una fecha sin hora corría
    // el cierre un día antes en Cancún, y una fecha de calendario imposible
    // producía un Invalid Date que Prisma rechazaba con un 500 opaco. Ahora
    // se valida aquí y se responde 400 con un mensaje útil.
    let expectedCloseDate: Date;
    if (d.expectedCloseDate) {
      const fecha = parseDueDate(d.expectedCloseDate);
      if (!fecha) {
        return NextResponse.json(
          {
            error: `expectedCloseDate inválido: "${d.expectedCloseDate}". Usa "YYYY-MM-DD" o "YYYY-MM-DDTHH:mm[:ss]" (opcionalmente con zona, ej. "Z" o "-05:00").`,
          },
          { status: 400 },
        );
      }
      expectedCloseDate = fecha;
    } else {
      expectedCloseDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 días default
    }

    const deal = await prisma.deal.create({
      data: {
        contactId: d.contactId,
        assignedToId: d.assignedToId,
        developmentId: d.developmentId || null,
        unitId: d.unitId || null,
        stage: d.stage ?? "NEW_LEAD",
        dealType: d.dealType,
        estimatedValue: d.estimatedValue,
        currency: d.currency ?? "MXN",
        // `??` y no `||`: una probabilidad de 0 es un dato, no un hueco. Con `||` se
        // guardaba 5 y el pipeline mostraba optimismo que nadie había declarado.
        probability: d.probability ?? 5,
        expectedCloseDate,
        leadSourceAtDeal: d.leadSourceAtDeal || "OTRO",
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

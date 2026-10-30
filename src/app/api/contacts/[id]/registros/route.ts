// ============================================================
// API Route: /api/contacts/[id]/registros (#939)
// POST - «Registrar» desde la ficha del broker: liga un contacto existente a ESTE broker.
//        Body: { contactId, reemplazar?: boolean }
// ============================================================
//
// Es lo mismo que elegir el broker en «Registrado por» del contacto (#907/#929), hecho desde el
// lado del broker. Puertas (las mismas que «Empresas», #949):
//   1. el rol trabaja contactos (la lista que puede darlos de alta) y tiene «Registrado por»
//      editable;
//   2. el broker es elegible (catálogo de «Registrado por», #935: vivo, tipo Broker, marca visible);
//   3. quien registra puede ABRIR la ficha del contacto (rol + marca): un asesor solo registra lo
//      suyo. Fuera de alcance → 403; inexistente → 404.
// Si el contacto ya tenía OTRO broker, responde 409 con su nombre y no lo cambia, salvo que venga
// `reemplazar: true` (la pantalla lo pregunta). Ligar pone la fuente en «Registro de Broker» (#929).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { withChangeSource } from "@/lib/audit/change-context";
import { resolveCoreFieldAccess, nonEditableKeys } from "@/lib/metadata/core-fields";
import { LEAD_SOURCE_BROKER } from "@/lib/constants";
import { puedeCrearEnCatalogo } from "@/lib/catalogos/clave";
import { brokerElegible } from "@/lib/contacts/catalogo-brokers";
import { MENSAJE_REFERIDO_INVALIDO, nombreDeContacto, validarReferidoPor } from "@/lib/contacts/referidos";
import { getContactAccessInfo } from "@/server/contacts";

const bodySchema = z
  .object({
    contactId: z.string().trim().min(1).max(64),
    reemplazar: z.boolean().optional(),
  })
  .strict();

type Sesion = { user: { id: string; role: string; plaza: string } };

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: brokerId } = await props.params;
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Falta el contacto" }, { status: 400 });
  const { contactId, reemplazar } = parsed.data;

  try {
    // 1. Rol que trabaja contactos y con «Registrado por» editable.
    const access = await resolveCoreFieldAccess("contact", session.user.role);
    if (!puedeCrearEnCatalogo(session.user.role) || nonEditableKeys("contact", access).has("referredById")) {
      return NextResponse.json({ error: "Tu rol no puede registrar contactos a un broker" }, { status: 403 });
    }

    // 2. El broker: elegible y de tipo Broker; no puede registrarse a sí mismo.
    const broker = await brokerElegible(session.user, brokerId);
    const motivo = validarReferidoPor({ contactId, referredById: brokerId, broker });
    if (motivo) {
      const status = motivo === "no_existe" ? 404 : 400;
      return NextResponse.json({ error: MENSAJE_REFERIDO_INVALIDO[motivo] }, { status });
    }

    // 3. El contacto: quien registra tiene que poder abrir su ficha.
    const acceso = await getContactAccessInfo(contactId, session as Sesion);
    if (!acceso.ok) {
      return acceso.reason === "forbidden"
        ? NextResponse.json({ error: "Solo puedes registrar contactos que tienes asignados" }, { status: 403 })
        : NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
    }

    const contacto = await prisma.contact.findFirst({
      where: { id: contactId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        referredById: true,
        referredBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!contacto) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

    if (contacto.referredById === brokerId) {
      return NextResponse.json({ data: { id: contacto.id, nombre: nombreDeContacto(contacto) }, yaEstaba: true });
    }
    if (contacto.referredById && !reemplazar) {
      return NextResponse.json(
        {
          error: "Este contacto ya está registrado por otro broker",
          brokerActual: contacto.referredBy ? nombreDeContacto(contacto.referredBy) : null,
        },
        { status: 409 },
      );
    }

    await withChangeSource({ source: "ui", actorId: session.user.id }, (tx) =>
      tx.contact.update({
        where: { id: contactId },
        data: { referredBy: { connect: { id: brokerId } }, leadSource: LEAD_SOURCE_BROKER },
      }),
    );
    return NextResponse.json({ data: { id: contacto.id, nombre: nombreDeContacto(contacto) }, yaEstaba: false });
  } catch (error) {
    console.error("[POST /api/contacts/[id]/registros]", error);
    return NextResponse.json({ error: "Error al registrar el contacto" }, { status: 500 });
  }
}

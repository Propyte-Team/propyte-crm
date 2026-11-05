// Endpoint autenticado para enviar SMS
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { sendSMS } from "@/lib/twilio/sms";
import { prisma } from "@/lib/db";
import { puedeTocarRecord } from "@/lib/rbac/record-access";
import { MENSAJE_SIN_TELEFONO, tieneTelefono } from "@/lib/contacts/sin-telefono";

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { contactId, body } = await req.json();

  if (!contactId || !body) {
    return NextResponse.json({ error: "contactId y body son requeridos" }, { status: 400 });
  }

  // Obtener teléfono del contacto
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { phone: true, doNotContact: true },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  }

  // Mismas puertas que /api/twilio/call (auditoría 2026-09-10): tener sesión no es permiso para
  // mandarle un SMS a CUALQUIER contacto —es un mensaje real, facturado a la empresa—, y «No
  // contactar» se respeta. Mismo 404 que si no existiera: un 403 confirmaría que el contacto está.
  if (!(await puedeTocarRecord("contact", contactId, session.user, "editar"))) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  }
  if (contact.doNotContact) {
    return NextResponse.json({ error: "Contacto marcado doNotContact" }, { status: 422 });
  }

  // #833: sin teléfono no hay a dónde mandar el SMS. Antes salía un 500 genérico.
  if (!tieneTelefono(contact.phone)) {
    return NextResponse.json({ error: MENSAJE_SIN_TELEFONO }, { status: 422 });
  }

  try {
    const message = await sendSMS(contact.phone, body, contactId, session.user.id);
    return NextResponse.json(message);
  } catch (error) {
    console.error("Error enviando SMS:", error);
    return NextResponse.json(
      { error: "Error al enviar SMS" },
      { status: 500 }
    );
  }
}

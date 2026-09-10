// Endpoint autenticado para iniciar llamada VoIP
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { initiateCall } from "@/lib/twilio/voice";
import { prisma } from "@/lib/db";
import { puedeTocarRecord } from "@/lib/rbac/record-access";

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { contactId } = await req.json().catch(() => ({ contactId: null }));

  if (!contactId || typeof contactId !== "string") {
    return NextResponse.json({ error: "contactId es requerido" }, { status: 400 });
  }

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { phone: true, firstName: true, lastName: true, doNotContact: true },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  }

  // Auditoría 2026-09-10: tener sesión no era permiso para llamar a CUALQUIERA. Esta ruta
  // comprobaba que el contacto existiera y nada más, así que cualquier rol autenticado
  // —MARKETING, HOSTESS, un asesor con el contacto de otro— podía poner el id en el cuerpo
  // y hacer que la centralita marcara a esa persona. No es sólo un dato que se filtra: es
  // una llamada real a un cliente ajeno, facturada a la cuenta de la empresa.
  //
  // Mismo 404 que si no existiera: un 403 confirmaría que el contacto sí está.
  if (!(await puedeTocarRecord("contact", contactId, session.user, "editar"))) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  }

  if (contact.doNotContact) {
    return NextResponse.json(
      { error: "Contacto marcado doNotContact" },
      { status: 422 }
    );
  }

  try {
    const result = await initiateCall(contact.phone, session.user.id, contactId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error iniciando llamada:", error);
    return NextResponse.json(
      { error: "Error al iniciar llamada" },
      { status: 500 }
    );
  }
}

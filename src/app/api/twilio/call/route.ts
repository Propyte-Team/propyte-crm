// Endpoint autenticado para iniciar llamada VoIP
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { initiateCall } from "@/lib/twilio/voice";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { contactId } = await req.json();

  if (!contactId) {
    return NextResponse.json({ error: "contactId es requerido" }, { status: 400 });
  }

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { phone: true, firstName: true, lastName: true },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
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

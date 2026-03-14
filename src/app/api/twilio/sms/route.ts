// Endpoint autenticado para enviar SMS
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { sendSMS } from "@/lib/twilio/sms";
import { prisma } from "@/lib/db";

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
    select: { phone: true },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
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

// Endpoint autenticado para enviar WhatsApp
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/twilio/whatsapp";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { contactId, body, templateName, templateParams } = await req.json();

  if (!contactId) {
    return NextResponse.json({ error: "contactId es requerido" }, { status: 400 });
  }

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { phone: true },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  }

  try {
    let message;

    if (templateName && templateParams) {
      message = await sendWhatsAppTemplate(
        contact.phone,
        templateName,
        templateParams,
        contactId,
        session.user.id
      );
    } else {
      if (!body) {
        return NextResponse.json({ error: "body es requerido" }, { status: 400 });
      }
      message = await sendWhatsAppMessage(contact.phone, body, contactId, session.user.id);
    }

    return NextResponse.json(message);
  } catch (error) {
    console.error("Error enviando WhatsApp:", error);
    return NextResponse.json(
      { error: "Error al enviar WhatsApp" },
      { status: 500 }
    );
  }
}

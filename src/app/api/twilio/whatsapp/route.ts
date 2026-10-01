// Endpoint autenticado para enviar WhatsApp
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/twilio/whatsapp";
import { findConversationForChannel } from "@/lib/messaging/conversations";
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

  // #828: este endpoint (lo usa el panel de conversación de Detalle de Contacto,
  // aparte del inbox) no resolvía connectorId en absoluto — con una sola línea de
  // WhatsApp es invisible, pero con 2+ marcas activas TODO mensaje enviado desde
  // aquí salía por el número global del env sin importar a cuál línea le escribió
  // el cliente. El inbox sí lo resuelve (conv.connectorId, ya guardado en la
  // conversación); aquí solo llega el contactId, así que se toma el hilo de
  // WhatsApp más reciente del contacto — mismo criterio que usan las rutas de
  // cadencia/workflow (lib/messaging/conversations.ts) para este mismo caso.
  const conversation = await findConversationForChannel(contactId, "WHATSAPP");
  const connectorId = conversation?.connectorId ?? null;

  try {
    let message;

    if (templateName && templateParams) {
      message = await sendWhatsAppTemplate(
        contact.phone,
        templateName,
        templateParams,
        contactId,
        session.user.id,
        connectorId
      );
    } else {
      if (!body) {
        return NextResponse.json({ error: "body es requerido" }, { status: 400 });
      }
      message = await sendWhatsAppMessage(contact.phone, body, contactId, session.user.id, connectorId);
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

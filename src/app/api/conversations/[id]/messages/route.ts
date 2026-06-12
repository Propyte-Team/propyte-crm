// Enviar mensaje en el hilo como asesor (o nota interna). POST { body, internalNote? }.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { sendWhatsAppMessage } from "@/lib/twilio/whatsapp";

const sendSchema = z.object({
  body: z.string().min(1).max(4096),
  internalNote: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const parsed = sendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const conv = await prisma.conversation.findUnique({
    where: { id: params.id },
    include: { contact: { select: { id: true, phone: true, doNotContact: true } } },
  });
  if (!conv) return NextResponse.json({ error: "No existe" }, { status: 404 });

  // Nota interna: NO se envía al contacto (§I.2)
  if (parsed.data.internalNote) {
    const note = await prisma.message.create({
      data: {
        contactId: conv.contact.id,
        userId: session.user.id,
        conversationId: conv.id,
        channel: conv.channel === "SMS" ? "SMS" : "WHATSAPP",
        direction: "OUTBOUND",
        body: parsed.data.body,
        status: "DELIVERED",
        externalPhone: conv.contact.phone,
        sender: "ADVISOR",
        internalNote: true,
      },
    });
    return NextResponse.json({ data: note }, { status: 201 });
  }

  if (conv.contact.doNotContact) {
    return NextResponse.json({ error: "Contacto marcado doNotContact" }, { status: 422 });
  }

  // Enviar como humano: si el bot seguía activo, el envío manual implica takeover suave
  const message = await sendWhatsAppMessage(
    conv.contact.phone,
    parsed.data.body,
    conv.contact.id,
    session.user.id
  );
  if (conv.status === "BOT") {
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { status: "HUMAN", controlledById: session.user.id, takeoverAt: new Date() },
    });
  }

  return NextResponse.json({ data: message }, { status: 201 });
}

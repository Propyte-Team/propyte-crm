// Enviar mensaje en el hilo como asesor (o nota interna). POST { body, internalNote? }.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { sendChannelMessage } from "@/lib/messaging/dispatcher";
import type { MessagingChannel } from "@/lib/messaging/types";

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
        // conv.channel puede ser WEB (no en MessageChannel); cast a MessageChannel es seguro
        // porque las conversaciones WEB no tienen nota interna activa en v1.
        channel: conv.channel as import("@prisma/client").MessageChannel,
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
  let message;
  try {
    message = await sendChannelMessage(
      conv.channel as MessagingChannel,
      conv.contact.id,
      parsed.data.body,
      session.user.id
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No se pudo enviar el mensaje" },
      { status: 422 }
    );
  }
  if (conv.status === "BOT") {
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { status: "HUMAN", controlledById: session.user.id, takeoverAt: new Date() },
    });
  }

  return NextResponse.json({ data: message }, { status: 201 });
}

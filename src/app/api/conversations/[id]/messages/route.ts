// Enviar mensaje en el hilo como asesor (o nota interna). POST { body?, internalNote?, media? }.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { sendChannelMessage } from "@/lib/messaging/dispatcher";
import type { MessagingChannel } from "@/lib/messaging/types";
import { CHAT_MEDIA_TYPES, type ChatMediaType } from "@/lib/messaging/media";
import { isInboxManager, canOwnInboxContact } from "@/lib/inbox/roles";
import { canViewInboxContact } from "@/lib/inbox/scope";
import { assignContact } from "@/lib/inbox/assign";

const sendSchema = z
  .object({
    body: z.string().max(4096).optional().default(""),
    internalNote: z.boolean().optional(),
    media: z
      .object({
        path: z.string().min(1).max(300),
        type: z.enum(CHAT_MEDIA_TYPES as [ChatMediaType, ...ChatMediaType[]]),
        filename: z.string().max(200).nullish(),
        mimeType: z.string().max(100).nullish(),
      })
      .optional(),
  })
  .refine((d) => d.body.trim().length > 0 || d.media, { message: "Mensaje vacío: falta texto o adjunto" })
  .refine((d) => !(d.internalNote && d.media), { message: "Las notas internas son solo de texto" })
  // el path de media debe ser del bucket (no URLs arbitrarias que Meta descargaría)
  .refine((d) => !d.media || !/^https?:\/\//i.test(d.media.path), { message: "media.path inválido" });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const parsed = sendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const conv = await prisma.conversation.findUnique({
    where: { id: params.id },
    include: {
      contact: {
        select: {
          id: true, phone: true, doNotContact: true, assignedToId: true,
          // teamLeaderId: lo necesita el alcance del TEAM_LEADER (ver scope.ts).
          assignedTo: { select: { teamLeaderId: true } },
        },
      },
    },
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

  // Aislamiento: escribir exige el MISMO alcance que leer (@/lib/inbox/scope), así el
  // gate no puede divergir del que decide qué hilos existen para este usuario.
  // 404 y no 403: el mensaje viejo ("asignado a otro asesor") confirmaba por URL directa
  // que el hilo existe Y su estado a alguien que ni siquiera lo ve en la lista. Mismo
  // cuerpo que el "No existe" de arriba: indistinguible a propósito.
  const esMando = isInboxManager(session.user.role);
  if (!canViewInboxContact(conv.contact, session.user)) {
    return NextResponse.json({ error: "No existe" }, { status: 404 });
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
      session.user.id,
      { connectorId: conv.connectorId, media: parsed.data.media ?? null }
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

  // Auto-claim: el primer no-mando que responde un hilo libre se queda el contacto.
  // Post-envío y best-effort: si el claim pierde una carrera, el mensaje ya salió
  // y el siguiente envío re-evalúa. Mando NO reclama (triagea sin quedarse leads).
  // canOwnInboxContact: el permiso REAL vive en assignContact (assign.ts), que ya
  // devuelve sin-permiso para roles como BROKER/HOSTESS/MARKETING — pero sin este
  // check cada mensaje suyo a un hilo libre garantiza esa llamada (y su console.error)
  // aunque el resultado sea el esperado por diseño: ruido, no un fallo real. Esto es
  // defensa en profundidad para no ejercitar una llamada condenada de antemano, no la
  // única barrera — si el criterio de assign.ts cambia y este no se actualiza, el peor
  // caso es una llamada de más, no un permiso de más.
  if (!conv.contact.assignedToId && !esMando && canOwnInboxContact(session.user.role)) {
    try {
      // assignContact NO lanza en sus fallos normales (conflicto de carrera,
      // usuario-invalido, etc.) — devuelve { ok: false, code }. Si se descarta el
      // resultado, esos fallos (los más probables) desaparecen sin rastro y el hilo
      // queda sin asignar para siempre.
      const res = await assignContact({
        contactId: conv.contact.id,
        assigneeId: session.user.id,
        actor: { id: session.user.id, role: session.user.role },
        conversationId: conv.id,
        source: "inbox_autoclaim",
      });
      if (!res.ok) console.error("[inbox] auto-claim no aplicado", res.code);
    } catch (e) {
      // Best-effort: el mensaje ya salió, no se revierte. Log consistente con assign.ts.
      console.error("[inbox] no se pudo auto-reclamar el contacto", e);
    }
  }

  return NextResponse.json({ data: message }, { status: 201 });
}

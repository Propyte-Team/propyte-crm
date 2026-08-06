// Acciones del hilo (Anexo B §I.5): takeover · release · close · snooze · toggle-bot · mark-spam · assign.
// POST { action: "takeover"|"release"|"close"|"snooze"|"toggle_bot"|"mark_spam"|"assign", until?, reason?, assigneeId? }
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import { getServerSession } from "@/lib/auth/session";
import { canMarkSpam } from "@/lib/moderation/roles";
import { isInboxManager } from "@/lib/inbox/roles";

const actionSchema = z.object({
  action: z.enum(["takeover", "release", "close", "snooze", "toggle_bot", "mark_spam", "assign"]),
  until: z.string().datetime().optional(),
  reason: z.string().max(500).optional(),
  // string = asignar/reclamar · null = quitar asignación · ausente solo válido si action ≠ assign
  assigneeId: z.string().min(1).nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // mark_spam se resuelve ANTES del gate genérico de esta ruta a propósito: borra datos,
  // así que usa el mismo conjunto de roles que el borrado de contactos y NO le vale ser
  // dueño del hilo. Ver src/lib/moderation/roles.ts.
  if (parsed.data.action === "mark_spam") {
    if (!canMarkSpam(session.user.role)) {
      return NextResponse.json({ error: "No tienes permiso para marcar spam" }, { status: 403 });
    }

    const { markConversationAsSpam, recordMetaResult } = await import("@/lib/moderation/block-sender");
    const result = await markConversationAsSpam({
      conversationId: params.id,
      actorId: session.user.id,
      reason: parsed.data.reason,
    });

    if (!result.ok) {
      if (result.code === "no-existe") return NextResponse.json({ error: "No existe" }, { status: 404 });
      if (result.code === "sin-identificador") {
        return NextResponse.json(
          { error: "Esta conversación no tiene un remitente que se pueda bloquear" },
          { status: 422 }
        );
      }
      return NextResponse.json(
        {
          error: `No se marcó como spam: el contacto tiene ${result.deals} negocio(s) y ${result.walkIns} visita(s). Revísalo a mano.`,
        },
        { status: 409 }
      );
    }

    // Meta es best-effort: su fallo queda registrado y reintentable, nunca tumba la respuesta.
    const connector = result.connectorId
      ? await prisma.leadConnector.findUnique({ where: { id: result.connectorId } })
      : null;
    const { getSocialPageToken } = await import("@/lib/messaging/social-accounts");
    const { blockOnMeta } = await import("@/lib/moderation/meta-moderation");
    const meta = await blockOnMeta({
      channel: result.channel,
      pageId: connector ? ((connector.config ?? {}) as { pageId?: string }).pageId ?? null : null,
      token: connector ? getSocialPageToken(connector) : null,
      identifier: result.identifier,
    });
    await recordMetaResult(result.blockedSenderId, meta);

    return NextResponse.json({ data: { blockedSenderId: result.blockedSenderId, meta } });
  }

  // assign se resuelve ANTES del gate genérico a propósito: un hilo sin asignar no
  // tiene dueño (el gate daría 403 al claim). El permiso real vive en assignContact.
  if (parsed.data.action === "assign") {
    if (parsed.data.assigneeId === undefined) {
      return NextResponse.json({ error: "Falta assigneeId (id de usuario o null)" }, { status: 400 });
    }
    const conv = await prisma.conversation.findUnique({
      where: { id: params.id },
      select: { id: true, contactId: true },
    });
    if (!conv) return NextResponse.json({ error: "No existe" }, { status: 404 });

    const { assignContact } = await import("@/lib/inbox/assign");
    const result = await assignContact({
      contactId: conv.contactId,
      assigneeId: parsed.data.assigneeId,
      actor: { id: session.user.id, role: session.user.role },
      conversationId: conv.id,
    });
    if (!result.ok) {
      const httpByCode = { "sin-permiso": 403, "ya-asignado": 409, "no-existe": 404, "usuario-invalido": 422, "conflicto": 409 } as const;
      const msgByCode = {
        "sin-permiso": "No tienes permiso para asignar este hilo",
        "ya-asignado": "El contacto ya está asignado a otro asesor",
        "no-existe": "No existe",
        "usuario-invalido": "El usuario elegido no está activo",
        "conflicto": "El hilo cambió, recarga",
      } as const;
      return NextResponse.json({ error: msgByCode[result.code] }, { status: httpByCode[result.code] });
    }
    return NextResponse.json({ data: { assignedTo: result.assignedTo } });
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: params.id },
    include: { contact: { select: { id: true, assignedToId: true, whatsappOptOut: true, firstName: true, lastName: true } } },
  });
  if (!conv) return NextResponse.json({ error: "No existe" }, { status: 404 });

  // Permiso: asesor asignado, quien controla, o management (§I.5)
  const isOwner = conv.contact.assignedToId === session.user.id || conv.controlledById === session.user.id;
  if (!isOwner && !isInboxManager(session.user.role)) {
    return NextResponse.json({ error: "Sin permiso sobre este hilo" }, { status: 403 });
  }

  const { action, until } = parsed.data;

  switch (action) {
    case "takeover": {
      const updated = await prisma.conversation.update({
        where: { id: params.id, updatedAt: conv.updatedAt }, // lock optimista (§I.7)
        data: {
          status: "HUMAN",
          controlledById: session.user.id,
          takeoverAt: new Date(),
        },
      }).catch(() => null);
      if (!updated) return NextResponse.json({ error: "El hilo cambió, recarga" }, { status: 409 });
      await prisma.activity.create({
        data: {
          contactId: conv.contact.id,
          userId: session.user.id,
          activityType: "NOTE",
          subject: "Tomó control de la conversación de WhatsApp",
          status: "COMPLETADA",
          completedAt: new Date(),
        },
      }).catch(() => {});
      return NextResponse.json({ data: { status: "HUMAN", controlledById: session.user.id } });
    }

    case "release": {
      if (conv.contact.whatsappOptOut) {
        return NextResponse.json({ error: "El contacto tiene opt-out; no se reactiva el bot" }, { status: 422 });
      }
      await prisma.conversation.update({
        where: { id: params.id },
        data: { status: "BOT", controlledById: null, botEnabled: true },
      });
      return NextResponse.json({ data: { status: "BOT" } });
    }

    case "close":
      await prisma.conversation.update({
        where: { id: params.id },
        data: { status: "CLOSED", controlledById: null },
      });
      return NextResponse.json({ data: { status: "CLOSED" } });

    case "snooze":
      await prisma.conversation.update({
        where: { id: params.id },
        data: {
          status: "SNOOZED",
          snoozedUntil: until ? new Date(until) : new Date(Date.now() + 24 * 3_600_000),
        },
      });
      return NextResponse.json({ data: { status: "SNOOZED" } });

    case "toggle_bot": {
      const updated = await prisma.conversation.update({
        where: { id: params.id },
        data: { botEnabled: !conv.botEnabled },
      });
      return NextResponse.json({ data: { botEnabled: updated.botEnabled } });
    }
  }
}

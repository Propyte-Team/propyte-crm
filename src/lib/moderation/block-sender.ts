// Marcar una conversación como spam, lado CRM. Solo base de datos: ninguna llamada de red.
// El bloqueo en Meta lo hace lib/moderation/meta-moderation.ts y su resultado se guarda
// después con recordMetaResult — mismo patrón que CommentRuleLog.dmStatus.
//
// No hay borrado duro: 11 tablas apuntan a contacts con RESTRICT/NO ACTION, así que un
// DELETE fallaría. Se anonimiza y se marca deletedAt, que además ya excluye al contacto
// de dashboard.ts y reports.ts.
import prisma from "@/lib/db";
import { withChangeSource } from "@/lib/audit/change-context";
import { toMessageChannel, identifierFor } from "./channel";
import type { MessageChannel } from "@prisma/client";
import type { MetaModerationResult } from "./meta-moderation";

const SPAM_TAG = "SPAM";

export type MarkSpamResult =
  | { ok: false; code: "no-existe" }
  | { ok: false; code: "sin-identificador" }
  | { ok: false; code: "tiene-negocio"; deals: number; walkIns: number }
  | {
      ok: true;
      blockedSenderId: string;
      channel: MessageChannel;
      identifier: string;
      connectorId: string | null;
    };

export async function markConversationAsSpam(args: {
  conversationId: string;
  actorId: string;
  reason?: string;
}): Promise<MarkSpamResult> {
  const conv = await prisma.conversation.findUnique({
    where: { id: args.conversationId },
    select: {
      id: true,
      channel: true,
      connectorId: true,
      contact: {
        select: { id: true, instagramId: true, messengerPsid: true, phone: true, tags: true },
      },
    },
  });
  if (!conv?.contact) return { ok: false, code: "no-existe" };

  const channel = toMessageChannel(conv.channel);
  if (!channel) return { ok: false, code: "sin-identificador" };
  const identifier = identifierFor(channel, conv.contact);
  if (!identifier) return { ok: false, code: "sin-identificador" };

  // Salvaguarda: un spammer no tiene negocio abierto. Las cotizaciones cuelgan de Deal
  // (Quote.dealId), no del contacto: sin deals no puede haber cotizaciones.
  const [deals, walkIns] = await Promise.all([
    prisma.deal.count({ where: { contactId: conv.contact.id } }),
    prisma.walkIn.count({ where: { contactId: conv.contact.id } }),
  ]);
  if (deals > 0 || walkIns > 0) return { ok: false, code: "tiene-negocio", deals, walkIns };

  const contact = conv.contact;
  const tags = contact.tags.includes(SPAM_TAG) ? contact.tags : [...contact.tags, SPAM_TAG];

  const blockedSenderId = await withChangeSource(
    { source: "inbox_spam", actorId: args.actorId },
    async (tx) => {
      const blocked = await tx.blockedSender.upsert({
        where: { channel_identifier: { channel, identifier } },
        create: {
          channel,
          identifier,
          reason: args.reason ?? null,
          blockedById: args.actorId,
          contactId: contact.id,
        },
        update: {
          reason: args.reason ?? null,
          blockedById: args.actorId,
          contactId: contact.id,
          unblockedAt: null,
          metaBlockStatus: "PENDING",
          metaSpamStatus: "PENDING",
          metaError: null,
        },
        select: { id: true },
      });

      // instagramId y messengerPsid se limpian OBLIGATORIAMENTE: sus índices únicos son
      // parciales (WHERE ... IS NOT NULL), así que dejarlos aquí impediría para siempre
      // crear un contacto legítimo futuro con ese mismo id. Ya están en blocked_senders.
      await tx.contact.update({
        where: { id: contact.id },
        data: {
          firstName: "Spam",
          lastName: "(bloqueado)",
          email: null,
          // phone es NOT NULL en el schema (a diferencia de email/secondaryPhone); el
          // cast es deliberado para preservar la anonimización pedida por diseño.
          phone: null as unknown as string,
          secondaryPhone: null,
          instagramId: null,
          messengerPsid: null,
          tags,
          contactStatus: "DESCARTADO",
          doNotContact: true,
          deletedAt: new Date(),
        },
      });

      await tx.conversation.update({
        where: { id: conv.id },
        data: { status: "CLOSED", botEnabled: false, unreadCount: 0, controlledById: null },
      });

      return blocked.id;
    }
  );

  return { ok: true, blockedSenderId, channel, identifier, connectorId: conv.connectorId };
}

/** Guarda el resultado del bloqueo en Meta. Best-effort: no puede tumbar la respuesta. */
export async function recordMetaResult(
  blockedSenderId: string,
  result: MetaModerationResult
): Promise<void> {
  try {
    await prisma.blockedSender.update({
      where: { id: blockedSenderId },
      data: {
        metaBlockStatus: result.blockStatus,
        metaSpamStatus: result.spamStatus,
        metaError: result.error ?? null,
      },
    });
  } catch (err) {
    console.error(`[moderation] no se pudo guardar el resultado de Meta (${blockedSenderId}):`, err);
  }
}

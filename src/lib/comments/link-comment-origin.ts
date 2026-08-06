// Puente entre el comentario y el contacto del CRM, en sus dos momentos:
//
//  a) persistOpenerCreatingContact — el DM acaba de salir. Si quien comentó ya
//     era contacto se le engancha el opener a su hilo; si NO lo era, se le
//     crea el contacto AHORA con captureLead y se le abre el hilo igual.
//
//     Cambio de producto (2026-08-06): antes esto se llamaba
//     persistOpenerForKnownContact y devolvía null cuando la persona no era
//     contacto — el DM salía pero el hilo no existía en ninguna parte, así que
//     el Inbox no lo mostraba hasta que la persona respondiera. Medido en
//     prod: 3 DMs del 5-ago con contactId null e invisibles. Ahora el hilo
//     nace con el envío.
//
//     Guardar el opener nosotros, como BOT, sigue siendo lo que evita que el
//     eco del propio mensaje entre como ADVISOR y dispare el takeover que
//     enmudece al bot (ver handleEchoMessage en lib/messaging/core.ts).
//
//  b) linkCommentOrigin — camino heredado: la persona responde el DM y el
//     intake acaba de crear el contacto. Con (a) funcionando el log ya viene
//     estampado y aquí no queda nada que reclamar, pero sigue vivo para los
//     logs viejos (contactId null) que quedaron antes de este cambio y para
//     los casos en que (a) no pudo escribir (contacto no capturable, blip de
//     la base): entonces estampa el origen y rellena el opener en el hilo.
import prisma from "@/lib/db";
import { PLACEHOLDER_LASTNAME } from "@/lib/messaging/types";

type Platform = "INSTAGRAM" | "FACEBOOK";
type Channel = "INSTAGRAM" | "MESSENGER";

const CHANNEL: Record<Platform, Channel> = {
  INSTAGRAM: "INSTAGRAM",
  FACEBOOK: "MESSENGER",
};

// LeadSource usa exactamente los mismos literales que Channel, así que se reusa
// CHANNEL en vez de declarar una segunda tabla que podría desincronizarse.
const DEFAULT_FIRST_NAME: Record<Platform, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Messenger",
};

/** Resultado del opener: a qué contacto quedó enganchado y si lo acabamos de crear. */
export interface OpenerResult {
  contactId: string;
  isNewContact: boolean;
  /** null si el eco de Meta ya había guardado ese mid antes que nosotros (P2002). */
  conversationId: string | null;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

async function findContactByRecipient(platform: Platform, recipientId: string) {
  const where =
    platform === "INSTAGRAM" ? { instagramId: recipientId } : { messengerPsid: recipientId };
  return prisma.contact.findFirst({
    where: { ...where, deletedAt: null, mergedIntoId: null },
    select: { id: true, assignedToId: true },
  });
}

/**
 * Nombre presentable para el contacto nuevo: IG manda `username`, Facebook el
 * nombre visible. Se limpia la arroba y se recorta a los 80 caracteres que
 * acepta incomingLeadSchema — pasarse haría fallar el parseo y perderíamos el
 * contacto entero por un nombre largo.
 */
function firstNameFromHandle(platform: Platform, authorHandle: string | null | undefined): string {
  const clean = (authorHandle ?? "").trim().replace(/^@+/, "").trim().slice(0, 80);
  return clean || DEFAULT_FIRST_NAME[platform];
}

/** Escribe el opener en el hilo del contacto, sin alterar el control del hilo. */
async function writeOpener(args: {
  contactId: string;
  assignedToId: string | null;
  channel: Channel;
  connectorId: string;
  text: string;
  externalMessageId: string;
  createdAt?: Date;
}) {
  const { ensureConversation } = await import("@/lib/messaging/conversations");
  const conversation = await ensureConversation({
    contactId: args.contactId,
    channel: args.channel,
    connectorId: args.connectorId,
  });

  try {
    await prisma.message.create({
      data: {
        contactId: args.contactId,
        userId: args.assignedToId,
        channel: args.channel,
        direction: "OUTBOUND",
        body: args.text,
        externalMessageId: args.externalMessageId,
        status: "SENT",
        conversationId: conversation.id,
        sender: "BOT",
        aiGenerated: false,
        ...(args.createdAt ? { createdAt: args.createdAt } : {}),
      },
    });
  } catch (err) {
    // El eco de Meta pudo haberlo guardado antes: mismo mid, índice único.
    if (isUniqueViolation(err)) return null;
    throw err;
  }

  // Solo lastMessageAt: tocar status o unreadCount rompería el control del hilo.
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });
  return conversation.id;
}

/**
 * Nota "Origen: comentario…" en la cronología del contacto.
 *
 * Extraída a función compartida porque ahora se puede crear en dos momentos
 * (al enviar el DM y, para los logs viejos, cuando la persona responde) y la
 * redacción y la regla de atribución tienen que ser idénticas en ambos: dos
 * versiones del mismo texto en la cronología es exactamente el ruido que se
 * quiere evitar.
 *
 * Activity.userId es NOT NULL: sin asesor asignado se atribuye a un ADMIN
 * activo; si tampoco hay, no se crea nada (la nota es trazabilidad, no dato
 * crítico).
 */
async function createOriginActivity(args: {
  contactId: string;
  assignedToId: string | null;
  postId: string;
  matchedPhrase: string;
}): Promise<void> {
  const userId =
    args.assignedToId ??
    (await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } }))
      ?.id;
  if (!userId) return;

  await prisma.activity.create({
    data: {
      contactId: args.contactId,
      userId,
      activityType: "NOTE",
      subject: `Origen: comentario en la publicación ${args.postId}`,
      description: `Comentó "${args.matchedPhrase}" y se le respondió en público + DM automático.`,
      status: "COMPLETADA",
      completedAt: new Date(),
    },
  });
}

/**
 * Reclama el log para este contacto. El updateMany condicionado a
 * `contactId: null` es el mismo candado atómico que usa linkCommentOrigin:
 * solo puede ganar una vez, así que la Activity de origen se crea exactamente
 * una vez pase lo que pase (envío + respuesta, dos webhooks a la vez, o un
 * reintento manual sobre un log ya vinculado).
 */
async function claimLogForContact(logId: string, contactId: string): Promise<boolean> {
  const claimed = await prisma.commentRuleLog.updateMany({
    where: { id: logId, contactId: null },
    data: { contactId },
  });
  return claimed.count === 1;
}

/**
 * Llamado justo después de que el DM de una regla sale por Graph. Deja el hilo
 * visible en el Inbox desde ese instante:
 *   contacto (existente o recién creado) → opener BOT → log estampado → nota de origen.
 *
 * La conversación queda como la deja ensureConversation (nace en BOT): cuando
 * la persona responda, Sage sigue el hilo. Aquí NO se toca `status`.
 */
export async function persistOpenerCreatingContact(args: {
  /** CommentRuleLog al que pertenece este DM: se estampa con el contactId. */
  logId: string;
  platform: Platform;
  connectorId: string;
  recipientId: string;
  /** username (IG) o nombre visible (FB) de quien comentó, si Meta lo mandó. */
  authorHandle: string | null;
  postId: string;
  matchedPhrase: string;
  text: string;
  externalMessageId: string;
}): Promise<OpenerResult | null> {
  const channel = CHANNEL[args.platform];

  let contactId: string;
  let assignedToId: string | null;
  let isNewContact = false;

  const known = await findContactByRecipient(args.platform, args.recipientId);
  if (known) {
    contactId = known.id;
    assignedToId = known.assignedToId;
  } else {
    // Alta por el camino canónico: dedup, ruteo, SLA y eventos salen gratis.
    const { captureLead } = await import("@/lib/intake/capture-lead");
    const idField =
      args.platform === "INSTAGRAM"
        ? { instagramId: args.recipientId }
        : { messengerPsid: args.recipientId };
    const result = await captureLead(
      {
        source: CHANNEL[args.platform],
        firstName: firstNameFromHandle(args.platform, args.authorHandle),
        lastName: PLACEHOLDER_LASTNAME,
        message: args.text,
        ...idField,
      },
      { connectorId: args.connectorId }
    );
    if (!result.contactId) {
      // El DM ya salió y el log ya quedó en SENT: no capturar el contacto es
      // una degradación (el hilo no aparece hasta que respondan), no un fallo
      // del envío. linkCommentOrigin lo recogerá si la persona contesta.
      console.warn(
        `[comments] DM enviado a ${args.recipientId} pero el lead no fue capturable: ${result.error ?? "captureLead devolvió contactId null"}`
      );
      return null;
    }
    contactId = result.contactId;
    assignedToId = result.assignedToId;
    isNewContact = result.isNew;
  }

  // Orden deliberado: opener → estampado → nota. Si el opener revienta por un
  // blip de la base, el log se queda con contactId null y linkCommentOrigin
  // vuelve a intentarlo todo cuando la persona responda (el comportamiento de
  // antes de este cambio). Estampar primero nos dejaría sin ese repesque.
  const conversationId = await writeOpener({
    contactId,
    assignedToId,
    channel,
    connectorId: args.connectorId,
    text: args.text,
    externalMessageId: args.externalMessageId,
  });

  if (await claimLogForContact(args.logId, contactId)) {
    try {
      await createOriginActivity({
        contactId,
        assignedToId,
        postId: args.postId,
        matchedPhrase: args.matchedPhrase,
      });
    } catch (err) {
      // Cosmética frente al vínculo: el log ya quedó estampado.
      console.error("[comments] actividad de origen falló:", err);
    }
  }

  return { contactId, isNewContact, conversationId };
}

/**
 * Llamado desde el intake cuando llega un inbound de IG/Messenger: si ese
 * remitente venía de un comentario y su log todavía no tiene contacto, se
 * cierra el círculo. Con persistOpenerCreatingContact en marcha esto solo
 * aplica a los logs anteriores al cambio o a los que no se pudieron estampar.
 */
export async function linkCommentOrigin(
  contactId: string,
  channel: Channel,
  senderId: string
): Promise<string | null> {
  const log = await prisma.commentRuleLog.findFirst({
    where: { dmRecipientId: senderId, contactId: null },
    orderBy: { createdAt: "desc" },
  });
  // Un log ya estampado (por el envío o por un inbound anterior) no entra en el
  // filtro: de ahí la idempotencia — ni segundo opener ni segunda actividad.
  if (!log) return null;

  // Candado atómico sin transacción: dos inbounds casi simultáneos del mismo
  // remitente (reintento del webhook de Meta, o dos mensajes seguidos) pueden
  // pasar los dos el findFirst de arriba antes de que cualquiera actualice. El
  // opener queda protegido por el índice único de externalMessageId, pero
  // activity.create no tenía ninguna protección: se creaban dos notas
  // idénticas "Origen: comentario…" en la cronología del contacto. El
  // updateMany condicionado a contactId: null solo puede "ganar" una vez.
  if (!(await claimLogForContact(log.id, contactId))) return null;

  // Un solo lookup del asesor para los dos pasos de abajo. Si falla, se sigue
  // con null: la nota se atribuye a un ADMIN y el opener queda sin userId.
  let assignedToId: string | null = null;
  try {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId },
      select: { id: true, assignedToId: true },
    });
    assignedToId = contact?.assignedToId ?? null;
  } catch (err) {
    console.error("[comments] lookup del asesor asignado falló:", err);
  }

  // Los dos pasos de abajo son cosméticos frente al estampado: si fallan, el
  // vínculo ya quedó hecho y no se pierde la trazabilidad.
  if (log.dmStatus === "SENT" && log.dmText && log.dmExternalMessageId) {
    try {
      await writeOpener({
        contactId,
        assignedToId,
        channel,
        connectorId: log.connectorId,
        text: log.dmText,
        externalMessageId: log.dmExternalMessageId,
        createdAt: log.createdAt, // el opener precede a la respuesta en el hilo
      });
    } catch (err) {
      console.error("[comments] backfill del opener falló:", err);
    }
  }

  try {
    await createOriginActivity({
      contactId,
      assignedToId,
      postId: log.postId,
      matchedPhrase: log.matchedPhrase,
    });
  } catch (err) {
    console.error("[comments] actividad de origen falló:", err);
  }

  return log.id;
}

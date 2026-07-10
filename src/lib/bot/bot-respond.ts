// botRespond — pipeline del bot WhatsApp L2 con red (Anexo B §I.4).
// Contexto → RAG catálogo Hub (data-gate) → Claude (voz Sage) → brand linter →
// envía o ESCALA a humano (intención fuerte / sin confianza).
import prisma from "@/lib/db";
import { askClaude, buildSystemPrompt, type BotMessage } from "./claude";
import { getBotConfig, type BotConfigResolved } from "./config";
import { lintBrandVoice } from "./brand-linter";
import { findMatchingDevelopments } from "./hub-catalog";
import type { MessagingChannel } from "@/lib/messaging/types";
import { sendChannelMessage } from "@/lib/messaging/dispatcher";

const ESCALATE_MARKER = "[ESCALAR]";

export function shouldBotRespondForChannel(config: BotConfigResolved, channel: string): boolean {
  return config.botEnabled && config.enabledChannels.includes(channel);
}

export function buildOpener(
  config: BotConfigResolved,
  contact: { firstName: string; preferredZone?: string | null },
): string {
  const interes = contact.preferredZone ? contact.preferredZone : "lo que busca";
  if (config.openerStyle === "DIRECT") {
    return `Este es el primer mensaje. Preséntate breve y haz UNA pregunta para empezar a calificar (${interes}). No suenes a script.`;
  }
  return `Este es el primer mensaje. Saluda a ${contact.firstName} por su nombre de forma cálida y natural, menciona brevemente su interés (${interes}) si lo conoces, y haz UNA pregunta para empezar a calificar. No suenes a script.`;
}

export async function escalateToHuman(conversationId: string, reason: string): Promise<void> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true },
  });
  if (!conv) return;

  // Resumen del hilo para que el asesor retome en segundos (§I.5)
  const history = await prisma.message.findMany({
    where: { conversationId, internalNote: false },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  const transcript = history
    .reverse()
    .map((m) => `${m.direction === "INBOUND" ? "Cliente" : "Bot/Asesor"}: ${m.body}`)
    .join("\n");
  const summary =
    (await askClaude({
      system: "Resume esta conversación de WhatsApp en 2-3 líneas para el asesor que la va a tomar. Incluye: qué busca el cliente, datos capturados, y el motivo de escalamiento. Español.",
      messages: [{ role: "user", content: `Motivo: ${reason}\n\n${transcript}` }],
      maxTokens: 200,
    }).catch(() => null)) ?? `Escalado: ${reason}`;

  const assigneeId = conv.contact.assignedToId;
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: "HUMAN",
      controlledById: assigneeId,
      takeoverAt: new Date(),
      aiSummary: summary,
    },
  });

  if (assigneeId) {
    await prisma.notification.create({
      data: {
        userId: assigneeId,
        title: "El bot te pasó una conversación",
        message: `${conv.contact.firstName} ${conv.contact.lastName}: ${summary.slice(0, 180)}`,
        type: "bot_escalation",
        link: `/inbox?c=${conversationId}`,
      },
    });
  }
}

export async function botRespond(
  contactId: string,
  opts: { goal?: string; createConversation?: boolean; channel?: MessagingChannel; connectorId?: string | null } = {}
): Promise<boolean> {
  const channel: MessagingChannel = opts.channel ?? "WHATSAPP";
  const config = await getBotConfig();
  if (!shouldBotRespondForChannel(config, channel)) return false;

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.doNotContact || (channel === "WHATSAPP" && contact.whatsappOptOut)) return false;

  const { ensureConversation, findConversationForChannel } = await import("@/lib/messaging/conversations");
  const connectorId = opts.connectorId ?? (await findConversationForChannel(contactId, channel))?.connectorId ?? null;
  const conv = opts.createConversation
    ? await ensureConversation({ contactId, channel, connectorId })
    : await findConversationForChannel(contactId, channel);
  if (!conv || conv.status !== "BOT" || !conv.botEnabled) return false;

  // Contexto: hilo + perfil + catálogo del Hub (data-gate: SOLO estas cifras son citables)
  const msgs = await prisma.message.findMany({
    where: { contactId, internalNote: false },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const history: BotMessage[] = msgs
    .reverse()
    .map((m): BotMessage => ({ role: m.direction === "INBOUND" ? "user" : "assistant", content: m.body }))
    .reduce<BotMessage[]>((acc, m) => {
      if (acc.length === 0 && m.role === "assistant") return acc;
      if (acc.length > 0 && acc[acc.length - 1].role === m.role) {
        acc[acc.length - 1] = { role: m.role, content: acc[acc.length - 1].content + "\n" + m.content };
        return acc;
      }
      acc.push(m);
      return acc;
    }, []);

  if (history.length === 0) {
    history.push({ role: "user", content: opts.goal ?? "(nuevo lead entrante)" });
  }

  const catalog = await findMatchingDevelopments({
    budgetMin: contact.budgetMin ? Number(contact.budgetMin) : null,
    budgetMax: contact.budgetMax ? Number(contact.budgetMax) : null,
    zone: contact.preferredZone,
  });

  const objective =
    history.length === 1 && history[0].role === "user" && !opts.goal
      ? buildOpener(config, { firstName: contact.firstName, preferredZone: contact.preferredZone })
      : undefined;

  const system = buildSystemPrompt({
    config,
    contact: { firstName: contact.firstName, preferredLanguage: contact.preferredLanguage },
    catalog,
    objective,
  });

  const reply = await askClaude({ system, messages: history, maxTokens: 300, model: config.model });
  if (!reply) return false; // sin API key

  const shouldEscalate = reply.includes(ESCALATE_MARKER);
  const clean = reply.replaceAll(ESCALATE_MARKER, "").trim();

  // Brand linter: si bloquea, NO se envía y se escala (mejor humano que hype)
  const lint = lintBrandVoice(clean);
  if (!lint.ok) {
    await escalateToHuman(conv.id, `Linter bloqueó respuesta del bot (${lint.violations.join(", ")})`);
    return false;
  }

  if (clean) {
    const ownerId =
      contact.assignedToId ??
      (await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } }))?.id;
    if (!ownerId) return false;

    // sendChannelMessage con opts.bot=true marca sender=BOT, aiGenerated=true, aiAutonomy=L2.
    await sendChannelMessage(channel, contact.id, clean, ownerId, { bot: true, connectorId: conv.connectorId });
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: new Date() },
    });
  }

  if (shouldEscalate) await escalateToHuman(conv.id, "Intención fuerte detectada por el bot");
  return true;
}

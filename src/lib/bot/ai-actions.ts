// Ejecutores de acciones AI_* del motor (Anexo §D.3/§D.6).
// Guardarraíles: autonomía por step, brand linter pre-envío, respeto a HUMAN/opt-out.
import prisma from "@/lib/db";
import type { Contact } from "@prisma/client";
import { askClaude, SAGE_SYSTEM_PROMPT, type BotMessage } from "./claude";
import { lintBrandVoice } from "./brand-linter";
import type { ActionResult } from "@/lib/workflows/actions";

async function conversationContext(contactId: string): Promise<BotMessage[]> {
  const msgs = await prisma.message.findMany({
    where: { contactId, internalNote: false },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return msgs
    .reverse()
    .map((m): BotMessage => ({
      role: m.direction === "INBOUND" ? "user" : "assistant",
      content: m.body,
    }))
    // Claude exige alternancia que empiece en user; recortar prefijo assistant
    .reduce<BotMessage[]>((acc, m) => {
      if (acc.length === 0 && m.role === "assistant") return acc;
      if (acc.length > 0 && acc[acc.length - 1].role === m.role) {
        acc[acc.length - 1] = { role: m.role, content: acc[acc.length - 1].content + "\n" + m.content };
        return acc;
      }
      acc.push(m);
      return acc;
    }, []);
}

function contactBrief(contact: Contact): string {
  const parts = [
    `Cliente: ${contact.firstName} ${contact.lastName}`,
    `Idioma: ${contact.preferredLanguage}`,
    contact.budgetMin || contact.budgetMax
      ? `Presupuesto: ${contact.budgetMin ?? "?"} - ${contact.budgetMax ?? "?"} MXN`
      : null,
    contact.preferredZone ? `Zona de interés: ${contact.preferredZone}` : null,
    contact.purchaseTimeline ? `Horizonte: ${contact.purchaseTimeline}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export async function runAiAction(
  actionType: "AI_REPLY" | "AI_DRAFT" | "AI_CALL_SUMMARY",
  contact: Contact,
  config: Record<string, unknown>
): Promise<ActionResult> {
  if (actionType === "AI_CALL_SUMMARY") {
    return { skipped: true, note: "Resumen de llamadas llega con la fase de voz" };
  }

  const autonomy = String(config.autonomyLevel ?? "L0");

  // AI_REPLY (L2): responde directo en el hilo — SOLO si la conversación sigue en BOT
  if (actionType === "AI_REPLY") {
    const { findConversationForChannel } = await import("@/lib/messaging/conversations");
    const conv = await findConversationForChannel(contact.id, "WHATSAPP");
    if (conv && (conv.status !== "BOT" || !conv.botEnabled)) {
      return { skipped: true, note: "Hilo en control humano o bot apagado" };
    }
    const { botRespond } = await import("./bot-respond");
    const sent = await botRespond(contact.id, {
      goal: String(config.goal ?? "seguimiento"),
      createConversation: true,
    });
    return sent ? {} : { skipped: true, note: "Bot sin respuesta (sin API key o escalado)" };
  }

  // AI_DRAFT (L0/L1): genera borrador y lo deja como nota+notificación al asesor
  const history = await conversationContext(contact.id);
  const goal = String(config.kind ?? config.goal ?? "seguimiento");
  const draft = await askClaude({
    system:
      SAGE_SYSTEM_PROMPT +
      `\n\nContexto del cliente: ${contactBrief(contact)}` +
      `\n\nTarea: redacta UN borrador de mensaje de WhatsApp (${goal}) para que el ASESOR lo revise y envíe. Devuelve SOLO el texto del mensaje.`,
    messages: history.length > 0 ? history : [{ role: "user", content: `Redacta el borrador (${goal}).` }],
  });
  if (!draft) return { skipped: true, note: "Sin ANTHROPIC_API_KEY" };

  const lint = lintBrandVoice(draft);
  if (!lint.ok) {
    return { skipped: true, note: `Brand linter bloqueó el borrador: ${lint.violations.join(", ")}` };
  }

  const userId = contact.assignedToId;
  if (!userId) return { skipped: true, note: "Contacto sin asesor para recibir el borrador" };

  await prisma.activity.create({
    data: {
      contactId: contact.id,
      userId,
      activityType: "NOTE",
      subject: `Borrador IA (${goal}) — revisar y enviar`,
      description: draft,
      status: "PENDIENTE",
    },
  });
  await prisma.notification.create({
    data: {
      userId,
      title: "Borrador IA listo",
      message: `${contact.firstName} ${contact.lastName}: borrador "${goal}" esperando tu revisión (L${autonomy.slice(-1)})`,
      type: "ai_draft",
      link: `/contacts/${contact.id}`,
    },
  });
  return {};
}

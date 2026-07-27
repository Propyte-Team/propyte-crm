// Ejecutores de acciones AI_* del motor (Anexo §D.3/§D.6).
// Guardarraíles: autonomía por step, brand linter pre-envío, respeto a HUMAN/opt-out.
import prisma from "@/lib/db";
import type { Contact } from "@prisma/client";
import { askClaude, buildSystemPrompt, type BotMessage } from "./claude";
import { getBotConfig, type BotConfigResolved } from "./config";
import { lintBrandVoice } from "./brand-linter";
import { findMatchingDevelopments } from "./hub-catalog";
import { nextTask, buildObjective, COMPLETION_OBJECTIVE, type PlaybookTaskLite } from "./playbook/engine";
import {
  selectAgentProfile,
  applyAgentTone,
  composeObjective,
  agentPlaybookOf,
  type AgentProfileWithPlaybook,
} from "./agent-profiles";
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

function fallbackDraftObjective(contact: Contact, goal: string): string {
  return (
    `Redacta UN borrador de mensaje de WhatsApp (${goal}) para que el ASESOR lo revise y envíe. ` +
    `Devuelve SOLO el texto del mensaje.\nContexto del cliente: ${contactBrief(contact)}`
  );
}

// Objetivo (capa 3) del borrador — SOLO LECTURA (Anexo Técnico §B-Task 8, follow-up).
// Playbook EFECTIVO (Frente 4): el del agente del segmento manda si trae uno (agentPlaybook,
// resuelto por agentPlaybookOf con el guard de >=1 tarea); si no, el global activo
// (config.activePlaybookId), igual que antes. Si hay playbook efectivo Y la conversación ya
// tiene ConversationPlaybookState, calcula el objetivo de la siguiente tarea con los helpers
// PUROS del engine (nextTask + buildObjective) sobre ese estado tal cual está — NUNCA lo crea
// (findUnique, no upsert), NUNCA marca tareas cumplidas, NUNCA escribe/extrae campos del
// Contact y NUNCA toca AuditLog. Si no hay playbook efectivo o la conversación no arrancó
// playbook, cae al objetivo/goal que el borrador ya recibía (comportamiento previo).
// Cualquier error aquí (config/playbook/estado) degrada al mismo fallback — jamás debe
// impedir que se genere el borrador (mismo criterio defensivo que runPlaybookStep).
async function resolveDraftObjective(
  contact: Contact,
  goal: string,
  config: BotConfigResolved,
  agentPlaybook: AgentProfileWithPlaybook["playbook"] | null = null
): Promise<string> {
  const fallback = fallbackDraftObjective(contact, goal);
  if (!agentPlaybook && !config.activePlaybookId) return fallback;

  try {
    const { findConversationForChannel } = await import("@/lib/messaging/conversations");
    const conv = await findConversationForChannel(contact.id, "WHATSAPP");
    if (!conv) return fallback;

    const state = await prisma.conversationPlaybookState.findUnique({
      where: { conversationId: conv.id },
    });
    if (!state) return fallback; // nunca arrancó el playbook: no lo iniciamos desde el borrador

    const pb =
      agentPlaybook ??
      (await prisma.botPlaybook.findFirst({
        where: { id: config.activePlaybookId!, isActive: true, deletedAt: null },
        include: { tasks: { where: { isActive: true }, orderBy: { order: "asc" } } },
      }));
    if (!pb || pb.tasks.length === 0) return fallback;

    const completedKeys = ((state.completedTaskKeys as string[]) ?? []) as string[];
    const task = nextTask(
      pb.tasks as unknown as PlaybookTaskLite[],
      completedKeys,
      contact as unknown as Record<string, unknown>
    );
    return task ? buildObjective(task) : COMPLETION_OBJECTIVE;
  } catch {
    return fallback;
  }
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

  // AI_DRAFT (L0/L1): genera borrador y lo deja como nota+notificación al asesor.
  // Mismo ensamblado en 4 capas que el bot en vivo (marca+tono+objetivo+catálogo, getBotConfig())
  // para que el tono elegible y (en modo lectura) el playbook le lleguen al borrador.
  const history = await conversationContext(contact.id);
  const goal = String(config.kind ?? config.goal ?? "seguimiento");

  const botConfig = await getBotConfig();

  // Agente por segmento (Frente 4): identidad + playbook + tono propios, igual que el
  // bot en vivo (bot-respond.ts) — pero SIN clasificar (maybeClassifyContact). AI_DRAFT
  // no debe tener side effects sobre el contacto ni gastar una llamada de clasificación:
  // se selecciona por el contactType YA existente. Best-effort: cualquier fallo (incluida
  // la ausencia del modelo botAgentProfile) degrada al comportamiento global de siempre.
  let agentProfile: AgentProfileWithPlaybook | null = null;
  try {
    const hasAgents = (await prisma.botAgentProfile.count({ where: { isActive: true, deletedAt: null } })) > 0;
    if (hasAgents) {
      agentProfile = await selectAgentProfile(prisma, contact.contactType);
    }
  } catch {
    // defensivo: sin agente → comportamiento global
  }
  const effectiveConfig = applyAgentTone(botConfig, agentProfile);

  const baseObjective = await resolveDraftObjective(contact, goal, effectiveConfig, agentPlaybookOf(agentProfile));
  const objective = composeObjective(agentProfile?.identity, baseObjective);
  const catalog = await findMatchingDevelopments({
    budgetMin: contact.budgetMin ? Number(contact.budgetMin) : null,
    budgetMax: contact.budgetMax ? Number(contact.budgetMax) : null,
    zone: contact.preferredZone,
  });

  const system = buildSystemPrompt({
    config: effectiveConfig,
    contact: { firstName: contact.firstName, preferredLanguage: contact.preferredLanguage },
    catalog,
    objective,
  });

  const draft = await askClaude({
    system,
    messages: history.length > 0 ? history : [{ role: "user", content: `Redacta el borrador (${goal}).` }],
    model: botConfig.model,
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

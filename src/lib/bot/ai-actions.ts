// Ejecutores de acciones AI_* del motor (Anexo §D.3/§D.6).
// Guardarraíles: autonomía por step, brand linter pre-envío, respeto a HUMAN/opt-out.
import prisma from "@/lib/db";
import type { Contact } from "@prisma/client";
import { askClaude, buildSystemPrompt, type BotMessage, type BrandPromptInput } from "./claude";
import { getBotConfig, type BotConfigResolved } from "./config";
import { resolveBrandForContact } from "@/lib/brands/resolve";
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

// Historial para el borrador. Con `conversationId` (solo cuando la conversación más reciente
// es de una marca no predeterminada, 2026-10-09) el contexto es ÚNICAMENTE el de ese hilo:
// lo hablado con el mismo cliente desde otra marca no debe colarse en el borrador. Sin él,
// igual que siempre (todo el contacto).
async function conversationContext(contactId: string, conversationId?: string | null): Promise<BotMessage[]> {
  const msgs = await prisma.message.findMany({
    where: conversationId ? { conversationId, internalNote: false } : { contactId, internalNote: false },
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

// Con `brandScoped` (borrador de una marca no predeterminada, 2026-10-09) se omiten presupuesto
// y zona: ese perfil pudo capturarse desde OTRA marca y contradiría el prompt de la marca
// ("no menciones otras ciudades"). Mismo criterio que bot-respond.ts (opener sin zona en
// marca) y que el catálogo de la marca (sin filtro de presupuesto/zona). Sin el flag, igual
// que siempre.
function contactBrief(contact: Contact, brandScoped = false): string {
  const parts = [
    `Cliente: ${contact.firstName} ${contact.lastName}`,
    `Idioma: ${contact.preferredLanguage}`,
    !brandScoped && (contact.budgetMin || contact.budgetMax)
      ? `Presupuesto: ${contact.budgetMin ?? "?"} - ${contact.budgetMax ?? "?"} MXN`
      : null,
    !brandScoped && contact.preferredZone ? `Zona de interés: ${contact.preferredZone}` : null,
    contact.purchaseTimeline ? `Horizonte: ${contact.purchaseTimeline}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function fallbackDraftObjective(contact: Contact, goal: string, brandScoped = false): string {
  return (
    `Redacta UN borrador de mensaje de WhatsApp (${goal}) para que el ASESOR lo revise y envíe. ` +
    `Devuelve SOLO el texto del mensaje.\nContexto del cliente: ${contactBrief(contact, brandScoped)}`
  );
}

// Opciones de la ruta de MARCA de resolveDraftObjective (2026-10-09). Sin ellas (ruta sin
// marca) la función se comporta exactamente como antes.
interface DraftObjectiveOpts {
  /** Borrador de una marca: el brief omite zona/presupuesto y el estado de playbook solo vale si es DE ESE playbook. */
  brandScoped?: boolean;
  /** Hilo cuyo ConversationPlaybookState se lee (el de la marca); evita findConversationForChannel, que mira todas las cuentas. */
  conversationId?: string | null;
  /** No caer al playbook global (config.activePlaybookId): sus preguntas de calificación son de Propyte. */
  noGlobalPlaybook?: boolean;
}

// Nota única de "no se puede generar el borrador de esta marca" (falla cerrado).
const BRAND_UNAVAILABLE_NOTE = "Marca de la cuenta no disponible";

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
//
// Ruta de marca (`opts`, 2026-10-09): el estado se lee del hilo de la marca (`conversationId`,
// no del hilo de WhatsApp más reciente de cualquier cuenta), solo vale si es de ESE playbook
// (state.playbookId === pb.id; si no, se trata como sin estado), no se cae al global
// (`noGlobalPlaybook`) y el brief omite zona/presupuesto (`brandScoped`).
async function resolveDraftObjective(
  contact: Contact,
  goal: string,
  config: BotConfigResolved,
  agentPlaybook: AgentProfileWithPlaybook["playbook"] | null = null,
  opts: DraftObjectiveOpts = {}
): Promise<string> {
  const { brandScoped = false, conversationId = null, noGlobalPlaybook = false } = opts;
  const fallback = fallbackDraftObjective(contact, goal, brandScoped);
  const globalPlaybookId = noGlobalPlaybook ? null : config.activePlaybookId;
  if (!agentPlaybook && !globalPlaybookId) return fallback;

  try {
    let stateConversationId = conversationId;
    if (!stateConversationId) {
      const { findConversationForChannel } = await import("@/lib/messaging/conversations");
      const conv = await findConversationForChannel(contact.id, "WHATSAPP");
      if (!conv) return fallback;
      stateConversationId = conv.id;
    }

    const state = await prisma.conversationPlaybookState.findUnique({
      where: { conversationId: stateConversationId },
    });
    if (!state) return fallback; // nunca arrancó el playbook: no lo iniciamos desde el borrador

    const pb =
      agentPlaybook ??
      (await prisma.botPlaybook.findFirst({
        where: { id: globalPlaybookId!, isActive: true, deletedAt: null },
        include: { tasks: { where: { isActive: true }, orderBy: { order: "asc" } } },
      }));
    if (!pb || pb.tasks.length === 0) return fallback;
    // Marca: el estado de OTRO playbook (p. ej. el global que corrió antes en ese hilo) no
    // sirve para calcular la siguiente tarea de este.
    if (brandScoped && state.playbookId !== pb.id) return fallback;

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
  //
  // Marca de la conversación más reciente del contacto (2026-10-09, spec marcas-agente §3.5):
  // AI_DRAFT no tiene conversación propia, así que se toma la marca del hilo más reciente.
  // Solo una marca NO predeterminada cambia algo; sin marca o con la predeterminada todo
  // queda igual que antes. "unavailable" (la cuenta tiene marca pero no se puede usar) NO
  // genera borrador: un borrador con la voz de otra marca es justo el error que esta capa
  // evita. `resolveBrandForContact` puede LANZAR (su lectura de la conversación no está
  // protegida): se falla cerrado igual que con "unavailable".
  let resolved: Awaited<ReturnType<typeof resolveBrandForContact>>;
  try {
    resolved = await resolveBrandForContact(contact.id);
  } catch (err) {
    console.error("[ai-actions] no se pudo resolver la marca del contacto:", contact.id, err);
    return { skipped: true, note: BRAND_UNAVAILABLE_NOTE };
  }
  const { resolution: brandRes, conversationId: brandConvId } = resolved;
  if (brandRes.kind === "unavailable") return { skipped: true, note: BRAND_UNAVAILABLE_NOTE };
  // Marca sin conversación no debería pasar (la marca sale de la conversación); si pasara, no
  // hay hilo de esa marca del cual armar el contexto → falla cerrado (nunca el hilo de todo el contacto).
  if (brandRes.kind === "brand" && !brandConvId) return { skipped: true, note: BRAND_UNAVAILABLE_NOTE };
  const brand = brandRes.kind === "brand" ? brandRes.brand : null;

  // Con marca: solo el hilo de ESA conversación (lo hablado desde otra marca no entra).
  const history = await conversationContext(contact.id, brand ? brandConvId : null);
  const goal = String(config.kind ?? config.goal ?? "seguimiento");

  const botConfig = await getBotConfig();

  // Agente por segmento (Frente 4): identidad + playbook + tono propios, igual que el
  // bot en vivo (bot-respond.ts) — pero SIN clasificar (maybeClassifyContact). AI_DRAFT
  // no debe tener side effects sobre el contacto ni gastar una llamada de clasificación:
  // se selecciona por el contactType YA existente. Best-effort: cualquier fallo (incluida
  // la ausencia del modelo botAgentProfile) degrada al comportamiento global de siempre.
  // Con marca NO hay agentes por segmento: la marca es la identidad (agentProfile queda null).
  let agentProfile: AgentProfileWithPlaybook | null = null;
  if (!brand) {
    try {
      const hasAgents = (await prisma.botAgentProfile.count({ where: { isActive: true, deletedAt: null } })) > 0;
      if (hasAgents) {
        agentProfile = await selectAgentProfile(prisma, contact.contactType);
      }
    } catch {
      // defensivo: sin agente → comportamiento global
    }
  }
  // El tono propio de la marca reemplaza al global; sin marca (o sin tono) todo igual.
  const baseConfig = brand?.tonePreset ? { ...botConfig, tonePreset: brand.tonePreset } : botConfig;
  const effectiveConfig = applyAgentTone(baseConfig, agentProfile);

  // Playbook de la marca (misma consulta e include que usa resolveDraftObjective para el
  // global). Si no existe, está inactivo/borrado o falla la lectura → null, y NO se cae al
  // global (sus preguntas de calificación son de Propyte): `noGlobalPlaybook` lo hace explícito.
  let brandPlaybook: AgentProfileWithPlaybook["playbook"] | null = null;
  if (brand?.playbookId) {
    try {
      brandPlaybook = await prisma.botPlaybook.findFirst({
        where: { id: brand.playbookId, isActive: true, deletedAt: null },
        include: { tasks: { where: { isActive: true }, orderBy: { order: "asc" } } },
      });
    } catch {
      brandPlaybook = null; // defensivo: sin playbook de la marca → objetivo fallback
    }
  }
  const baseObjective = brand
    ? await resolveDraftObjective(contact, goal, effectiveConfig, brandPlaybook, {
        brandScoped: true,
        conversationId: brandConvId,
        noGlobalPlaybook: true,
      })
    : await resolveDraftObjective(contact, goal, effectiveConfig, agentPlaybookOf(agentProfile));
  const objective = composeObjective(agentProfile?.identity, baseObjective);
  // Fallo de catálogo ≠ catálogo vacío: propagamos el mismo criterio que bot-respond.ts
  // (omitir el brief del prompt, no fingir que no hay inventario).
  // Con marca: el catálogo es SOLO el de los desarrollos de la marca (sin filtrar por
  // presupuesto/zona del contacto: ese perfil puede venir de otra marca).
  const { data: catalog, error: catalogError } = brand
    ? await findMatchingDevelopments({ developmentIds: brand.developmentIds, limit: 10 })
    : await findMatchingDevelopments({
        budgetMin: contact.budgetMin ? Number(contact.budgetMin) : null,
        budgetMax: contact.budgetMax ? Number(contact.budgetMax) : null,
        zone: contact.preferredZone,
      });
  if (catalogError) console.error("[ai-actions] catálogo del Hub no disponible:", catalogError);

  // Spread condicional: sin marca los argumentos son idénticos a los de siempre
  // (`brand` ausente, no `brand: undefined`) y el prompt no cambia ni un byte.
  const brandPrompt: BrandPromptInput | undefined = brand
    ? { name: brand.name, persona: brand.persona, knowledge: brand.knowledge }
    : undefined;
  const system = buildSystemPrompt({
    config: effectiveConfig,
    contact: { firstName: contact.firstName, preferredLanguage: contact.preferredLanguage },
    catalog,
    objective,
    ...(brandPrompt ? { brand: brandPrompt } : {}),
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

// botRespond — pipeline del bot WhatsApp L2 con red (Anexo B §I.4).
// Contexto → RAG catálogo Hub (data-gate) → Claude (voz Sage) → brand linter →
// envía o ESCALA a humano (intención fuerte / sin confianza).
import prisma from "@/lib/db";
import { askClaude, buildSystemPrompt, ESCALATE_TOKEN, type BotMessage, type BrandPromptInput } from "./claude";
import { ESCALATE_MARKETING_TOKEN, getMarketingOwnerId } from "./marketing-routing";
import { getBotConfig, type BotConfigResolved } from "./config";
import { lintBrandVoice } from "./brand-linter";
import { findMatchingDevelopments } from "./hub-catalog";
import { runPlaybookStep } from "./playbook/run";
import type { MessagingChannel } from "@/lib/messaging/types";
import { sendChannelMessage } from "@/lib/messaging/dispatcher";
import { applyAgentTone, composeObjective, agentPlaybookOf } from "./agent-profiles";
import { resolveBrandForConnector, isBrandScoped } from "@/lib/brands/resolve";
import { brandEnabledChannels } from "@/lib/brands/settings";

/**
 * `enabledChannelsOverride` (2026-10-09, marcas del agente): los canales propios de la marca
 * reemplazan a `config.enabledChannels`; null/undefined = los globales. El interruptor
 * maestro `botEnabled` sigue mandando siempre.
 */
export function shouldBotRespondForChannel(
  config: BotConfigResolved,
  channel: string,
  enabledChannelsOverride?: string[] | null,
): boolean {
  return config.botEnabled && (enabledChannelsOverride ?? config.enabledChannels).includes(channel);
}

export function buildOpener(
  config: BotConfigResolved,
  contact: { firstName: string; preferredZone?: string | null },
  goal?: string,
): string {
  const interes = contact.preferredZone ? contact.preferredZone : "lo que busca";
  const goalLine = goal ? ` El objetivo de este primer mensaje es: ${goal}.` : "";
  if (config.openerStyle === "DIRECT") {
    return `Este es el primer mensaje. Preséntate breve y haz UNA pregunta para empezar a calificar (${interes}).${goalLine} No suenes a script.`;
  }
  return `Este es el primer mensaje. Saluda a ${contact.firstName} por su nombre de forma cálida y natural, menciona brevemente su interés (${interes}) si lo conoces, y haz UNA pregunta para empezar a calificar.${goalLine} No suenes a script.`;
}

export async function escalateToHuman(
  conversationId: string,
  reason: string,
  opts: { routeToUserId?: string | null } = {},
): Promise<void> {
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

  // `routeToUserId` gana sobre el asesor del contacto: es el caso de las propuestas de
  // marketing (siempre a Luis Flores, ver marketing-routing.ts), que no son un lead de
  // ningún asesor. No se reasigna el contacto —solo quién controla el hilo y a quién se
  // le avisa—: tocar la asignación del contacto es decisión humana desde el inbox.
  const assigneeId = opts.routeToUserId ?? conv.contact.assignedToId;
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

/**
 * ¿El contacto está atribuido a alguna marca NO predeterminada (no borrada)? Tabla o columna
 * inexistente (P2021/P2022: migración sin aplicar) = sin filas. Cualquier otro error de lectura
 * falla cerrado (true): mismo criterio que la marca "no disponible" de resolveBrandForConnector.
 */
async function contactBelongsToOtherBrand(contactId: string): Promise<boolean> {
  try {
    const row = await prisma.contactBrand.findFirst({
      where: { contactId, brand: { isDefault: false, deletedAt: null } },
      select: { brandId: true },
    });
    if (row) {
      console.warn("[bot-respond] contacto de otra marca sin cuenta: no se abre conversación desde el número global", contactId);
    }
    return !!row;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "P2021" || code === "P2022") return false;
    console.error("[bot-respond] no se pudieron leer las marcas del contacto; no se abre conversación", contactId, err);
    return true;
  }
}

export async function botRespond(
  contactId: string,
  opts: { goal?: string; createConversation?: boolean; channel?: MessagingChannel; connectorId?: string | null } = {}
): Promise<boolean> {
  const channel: MessagingChannel = opts.channel ?? "WHATSAPP";
  const config = await getBotConfig();
  // Atajo barato y sin cambio de conducta: con el master switch apagado nadie contesta.
  if (!config.botEnabled) return false;

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.doNotContact || (channel === "WHATSAPP" && contact.whatsappOptOut)) return false;

  const { ensureConversation, findConversationForChannel } = await import("@/lib/messaging/conversations");
  // `null` EXPLÍCITO ≠ `undefined` (2026-10-09, revisión final C2): `null` = el llamador SABE que
  // el mensaje llegó al número global (los webhooks pasan la cuenta resuelta o null) y no se
  // infiere nada — inferir podía tomar la cuenta del hilo de otra marca y contestar como ella a
  // un mensaje que el cliente mandó al número de Propyte. `undefined` = el llamador no lo sabe
  // (workflow, ingesta sin cuenta) → la cuenta del hilo más reciente, igual que siempre.
  const connectorId =
    opts.connectorId !== undefined
      ? opts.connectorId
      : ((await findConversationForChannel(contactId, channel))?.connectorId ?? null);

  // Marca de la cuenta (2026-10-09, spec marcas-agente §3.2). Solo una marca NO
  // predeterminada cambia algo; "unavailable" = la cuenta tiene marca pero no se puede
  // usar → NO contestar (mejor callado que responder como otra marca). El chequeo de
  // canal va DESPUÉS de resolver la marca porque los canales pueden ser propios de la marca.
  const brandRes = await resolveBrandForConnector(connectorId);
  if (brandRes.kind === "unavailable") return false;
  const brand = isBrandScoped(brandRes) ? brandRes.brand : null;
  if (!shouldBotRespondForChannel(config, channel, brand ? brandEnabledChannels(brand) : null)) return false;

  // Abrir conversación SIN cuenta (AI_REPLY de un workflow, 2026-10-09, revisión final I3) = escribir
  // desde el número global con la voz de Propyte. Si el contacto está atribuido a otra marca (fila en
  // contact_brands de una marca no predeterminada viva), no se abre nada: sería un mensaje de Propyte
  // a un prospecto de esa marca. Sin filas de otra marca (todos los contactos de hoy) → igual que siempre.
  if (opts.createConversation && !connectorId && (await contactBelongsToOtherBrand(contactId))) return false;

  // La conversación debe ser la de ESA cuenta. `findConversationForChannel` devuelve el hilo
  // más reciente del contacto en el canal entre TODAS las cuentas: un contacto con hilos en
  // el número de Propyte y en el de Yaxnáh podría recibir la voz de una marca por el número
  // de la otra (el envío sale por `conv.connectorId`). Con `opts.connectorId` explícito se
  // busca primero el hilo de esa cuenta — también con `null` (número global): el hilo sin
  // cuenta, el mismo que eligió la ingesta en `ensureConversation` —; sin él (`undefined`),
  // igual que siempre. Si el hilo resultante es de otra cuenta y alguna de las dos tiene marca,
  // el cinturón de abajo no deja contestar (2026-10-09).
  const conv = opts.createConversation
    ? await ensureConversation({ contactId, channel, connectorId })
    : opts.connectorId !== undefined
      ? ((await prisma.conversation.findFirst({ where: { contactId, channel, connectorId: opts.connectorId } })) ??
        (await findConversationForChannel(contactId, channel)))
      : await findConversationForChannel(contactId, channel);
  if (!conv || conv.status !== "BOT" || !conv.botEnabled) return false;

  // Cinturón: si aun así el hilo es de otra cuenta que la resuelta, y alguna de las dos tiene
  // marca (o no se puede resolver), NO se contesta — nunca como una marca por la cuenta de
  // otra. Si ambas son predeterminadas, sigue como siempre.
  if ((conv.connectorId ?? null) !== (connectorId ?? null)) {
    const convBrandRes = await resolveBrandForConnector(conv.connectorId);
    if (brandRes.kind !== "default" || convBrandRes.kind !== "default") return false;
  }

  // Agente de la marca apagado: no contesta, pero tampoco deja al cliente sin atender —
  // la conversación pasa a un humano (una sola vez: queda en HUMAN y deja de entrar aquí).
  if (brand && !brand.botEnabled) {
    await escalateToHuman(conv.id, `Agente de la marca «${brand.name}» apagado`);
    return false;
  }

  // Contexto: hilo + perfil + catálogo del Hub (data-gate: SOLO estas cifras son citables)
  const msgs = await prisma.message.findMany({
    // Con marca: solo ESTA conversación — lo hablado con el mismo cliente desde otra
    // marca no entra al contexto. Sin marca: igual que siempre (todo el contacto).
    where: brand ? { conversationId: conv.id, internalNote: false } : { contactId, internalNote: false },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  // Watermark anti-burst: el mensaje más nuevo VISTO al armar el contexto. Si al terminar
  // de generar ya existe algo más nuevo (ráfaga texto+adjuntos, webhooks concurrentes u
  // otra generación que ya contestó), esta respuesta se descarta (ver guard abajo).
  const watermark = msgs[0]?.createdAt ?? null;
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
    history.push({ role: "user", content: "(nuevo lead entrante)" });
  }

  // Fallo de catálogo ≠ catálogo vacío: si la consulta al Hub falló, omitimos el brief
  // del prompt (buildSystemPrompt cae a "no cites precios") en vez de fingir que no hay
  // inventario. NO se escala solo por esto: el bot puede seguir calificando sin catálogo.
  //
  // Con marca (2026-10-09): el catálogo es SOLO el de los desarrollos de la marca (sin
  // filtrar por presupuesto/zona del contacto: ese perfil puede venir de otra marca).
  const { data: catalog, error: catalogError } = brand
    ? await findMatchingDevelopments({ developmentIds: brand.developmentIds, limit: 10 })
    : await findMatchingDevelopments({
        budgetMin: contact.budgetMin ? Number(contact.budgetMin) : null,
        budgetMax: contact.budgetMax ? Number(contact.budgetMax) : null,
        zone: contact.preferredZone,
      });
  if (catalogError) console.error("[bot-respond] catálogo del Hub no disponible:", catalogError);

  // Agentes por segmento (Frente 4): clasificar tipo de conversación y elegir el agente
  // (identidad + playbook + tono propios). Solo gasta clasificación si hay agentes activos.
  // Best-effort: cualquier fallo deja el flujo global de siempre intacto.
  // Con marca NO hay agentes por segmento ni clasificador: la marca es la identidad
  // (agentProfile queda en null).
  let agentProfile: import("./agent-profiles").AgentProfileWithPlaybook | null = null;
  if (!brand) {
    try {
      const hasAgents = (await prisma.botAgentProfile.count({ where: { isActive: true, deletedAt: null } })) > 0;
      if (hasAgents) {
        const { maybeClassifyContact } = await import("./classify");
        const { selectAgentProfile } = await import("./agent-profiles");
        const effectiveType = config.classifyContacts
          ? await maybeClassifyContact(prisma, contact, history, config.model)
          : contact.contactType;
        agentProfile = await selectAgentProfile(prisma, effectiveType);
      }
    } catch {
      // defensivo: sin agente → comportamiento global
    }
  }
  // El tono propio de la marca reemplaza al global; sin marca (o sin tono) todo igual.
  const baseConfig = brand?.tonePreset ? { ...config, tonePreset: brand.tonePreset } : config;
  const effectiveConfig = applyAgentTone(baseConfig, agentProfile);

  const firstTouch = history.length === 1 && history[0].role === "user";
  const fallbackObjective = firstTouch
    ? buildOpener(
        effectiveConfig,
        // Con marca NO se inyecta la zona del contacto (puede venir de otra marca y
        // contradiría "no menciones otras ciudades" del prompt de la marca).
        { firstName: contact.firstName, preferredZone: brand ? null : contact.preferredZone },
        opts.goal,
      )
    : opts.goal
      ? `Objetivo de este mensaje: ${opts.goal}. Continúa la conversación con naturalidad.`
      : undefined;

  // Playbook configurable (Anexo Técnico §B-Task 8): el del agente del segmento manda;
  // si NO hay agente de segmento resuelto, el global activo. Su objective gana sobre la
  // ruta A. Cualquier error aquí cae al fallback de arriba — nunca debe impedir que el
  // bot responda.
  //
  // FIX 2026-09-21 (hallazgo de Luis): antes, `agentPlaybook ?? (global)` caía al
  // playbook global en cuanto el agente del segmento no traía uno propio — así "Agente
  // Clientes Actuales" (playbookId null, a propósito: su identidad dice "NUNCA lo
  // vuelvas a calificar") terminaba recibiendo el objective de "Calificación base" (las
  // 5 preguntas de comprador), que le ganaba a su propia identidad en el prompt
  // compuesto. El fallback al global solo debe aplicar cuando NO hay ningún agente de
  // segmento resuelto para el contacto (LEAD/PROSPECTO sin clasificar) — si sí hay
  // agente pero decidió no traer playbook, eso es intencional y se respeta.
  //
  // Con marca (2026-10-09): manda el playbook de la marca (brand.playbookId); una marca sin
  // playbook propio NO hereda el global (sus preguntas de calificación son de Propyte).
  const agentPlaybook = agentPlaybookOf(agentProfile);
  const brandPlaybookId = brand?.playbookId ?? null;
  const useGlobalPlaybook = !brand && !agentProfile && !!config.activePlaybookId;
  let playbookObjective: string | undefined;
  if (agentPlaybook || useGlobalPlaybook || brandPlaybookId) {
    try {
      const pb = agentPlaybook
        ?? (await prisma.botPlaybook.findFirst({
          where: { id: (brandPlaybookId ?? config.activePlaybookId)!, isActive: true, deletedAt: null },
          include: { tasks: { where: { isActive: true }, orderBy: { order: "asc" } } },
        }));
      if (pb && pb.tasks.length > 0) {
        const pr = await runPlaybookStep(prisma, {
          playbook: { id: pb.id, tasks: pb.tasks as any },
          conversationId: conv.id,
          contact,
          messages: history,
          model: config.model,
          // Con marca, el estado de OTRO playbook en este hilo (p. ej. el global, que corrió antes
          // de asignarle la marca a la cuenta) no cuenta como avance de este: se reinicia para el
          // playbook de la marca (mismo criterio que AI_DRAFT). Sin marca: argumentos de siempre.
          ...(brand ? { ignoreForeignState: true } : {}),
        });
        if (pr.objective) playbookObjective = pr.objective;
      }
    } catch {
      // defensivo: cae al objective de la ruta A
    }
  }

  // La identidad del agente antecede al objetivo del playbook/ruta A en la capa "objetivo"
  const baseObjective = playbookObjective ?? fallbackObjective;
  const objective = composeObjective(agentProfile?.identity, baseObjective);

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

  const reply = await askClaude({ system, messages: history, maxTokens: 300, model: config.model });
  if (!reply) return false; // sin API key

  // Guard anti-burst (BUG 2026-07-24: texto + 2 PDFs → 3 respuestas): si mientras
  // generábamos llegó CUALQUIER mensaje nuevo (inbound del cliente, respuesta de otra
  // generación concurrente, o un humano tomando el hilo), se descarta esta respuesta.
  // El trigger del mensaje más nuevo responde con el contexto completo — nada se pierde.
  const newer = await prisma.message.findFirst({
    where: {
      contactId,
      internalNote: false,
      ...(watermark ? { createdAt: { gt: watermark } } : {}),
    },
    select: { id: true },
  });
  if (newer) return false;

  const shouldEscalateMarketing = reply.includes(ESCALATE_MARKETING_TOKEN);
  const shouldEscalate = reply.includes(ESCALATE_TOKEN);
  // Los dos tokens se quitan SIEMPRE: ninguno debe llegarle al cliente.
  const clean = reply.replaceAll(ESCALATE_MARKETING_TOKEN, "").replaceAll(ESCALATE_TOKEN, "").trim();

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

  if (shouldEscalateMarketing) {
    // Sin responsable válido (null) escala igual que cualquier otro caso — nunca se pierde.
    // Con marca, primero su responsable de marketing (si está activo); si no, la cadena de siempre.
    await escalateToHuman(conv.id, "Propuesta comercial / de marketing: no busca propiedad", {
      routeToUserId: await getMarketingOwnerId(brand?.marketingOwnerUserId ?? null),
    });
  } else if (shouldEscalate) {
    await escalateToHuman(conv.id, "Intención fuerte detectada por el bot");
  }
  return true;
}

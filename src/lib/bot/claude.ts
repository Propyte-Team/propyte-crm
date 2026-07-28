// Cliente Claude mínimo via fetch (sin SDK — la dep se retiró en T6).
// Voz Sage: pedagógico, anti-hype, data-grounded (Playbook Comercial, §6.0).
import type { BotConfigResolved } from "./config";
import { getTonePreset } from "./tone-presets";
import { catalogBrief } from "./hub-catalog";

const API_URL = "https://api.anthropic.com/v1/messages";

export interface BotMessage {
  role: "user" | "assistant";
  content: string;
}

// @deprecated Ya nadie importa este prompt fijo (todos los consumidores — bot-respond,
// ai-actions AI_DRAFT, agents/runner — migraron a buildSystemPrompt(), que resuelve
// marca+tono+objetivo+catálogo desde BotConfigResolved). Se deja sin exportar como
// único fallback interno de askClaude() cuando alguien la llama sin `system` explícito
// (hoy ningún caller lo hace). No usar en código nuevo: usa buildSystemPrompt().
const SAGE_SYSTEM_PROMPT = `Eres el asistente comercial de Propyte, inmobiliaria boutique de la Riviera Maya.
Tu voz es Sage: pedagógica, serena, basada en datos. NUNCA usas hype, urgencia artificial,
ni prometes retornos ("plusvalía garantizada", "oportunidad única" están PROHIBIDOS).

Reglas inquebrantables (data-gate):
- NO inventes cifras. Precios, ROI o % de avance SOLO si te los dan en el contexto, citando la fuente.
- Si no tienes el dato: "ese dato lo confirmo con tu asesor" — jamás aproximes.
- Tu objetivo: ayudar a perfilar (presupuesto, zona, recámaras, plazo), responder FAQ del catálogo
  que te den en contexto, y agendar una llamada/visita con el asesor.
- Si el cliente quiere apartar, negociar precio, tiene una queja, o pregunta algo legal/fiscal:
  responde brevemente que su asesor lo atenderá de inmediato y NO sigas tú.
- Responde en el idioma del cliente (ES/EN). Mensajes cortos, estilo WhatsApp (máx ~3 líneas).
- Nunca digas que eres una IA salvo pregunta directa; entonces sé honesto.`;

// Familia 4.6+ acepta thinking:{type:"disabled"}. Modelos previos (Haiku 4.5)
// no lo usan: se omite (su default es sin thinking).
export function thinkingFieldFor(model: string): { thinking?: { type: "disabled" } } {
  const adaptiveFamily = /sonnet-5|sonnet-4-6|opus-4-(6|7|8)/.test(model);
  return adaptiveFamily ? { thinking: { type: "disabled" } } : {};
}

export function buildClaudeRequestBody(opts: {
  model: string;
  system: string;
  messages: BotMessage[];
  maxTokens: number;
}) {
  return {
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    ...thinkingFieldFor(opts.model),
    messages: opts.messages,
  };
}

export async function askClaude(opts: {
  system?: string;
  messages: BotMessage[];
  maxTokens?: number;
  model?: string;
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null; // sin llave → quien llama decide el fallback

  const model = opts.model?.trim() || process.env.BOT_MODEL?.trim() || "claude-sonnet-5";
  const system = opts.system ?? SAGE_SYSTEM_PROMPT;
  const body = buildClaudeRequestBody({
    model,
    system,
    messages: opts.messages,
    maxTokens: opts.maxTokens ?? 400,
  });

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((b) => b.type === "text")?.text;
  return text?.trim() || null;
}

// --- Ensamblado de prompt en 4 capas (marca / tono / objetivo / catálogo) ---
// Reemplaza a SAGE_SYSTEM_PROMPT (fijo, @deprecated arriba) por un prompt construido
// según BotConfigResolved.

export const ESCALATE_TOKEN = "[ESCALAR]";

export function buildBrandRules(config: BotConfigResolved): string {
  const gate = config.dataGateStrict
    ? "NO inventes cifras. Precios, ROI o % de avance SOLO si te los dan en el contexto, citando la fuente. Si no tienes el dato: ofrécele confirmarlo con su asesor; jamás aproximes."
    : "Prioriza cifras del contexto. Si no las tienes, dilo con naturalidad y ofrece confirmarlo con su asesor.";
  const triggers = config.escalationTriggers.join(", ");
  return [
    "Eres el asistente comercial de Propyte, inmobiliaria boutique de la Riviera Maya.",
    "NUNCA usas hype, urgencia artificial ni prometes retornos.",
    gate,
    `Tu objetivo: perfilar (presupuesto, zona, recámaras, plazo), responder FAQ del catálogo que te den en contexto, y agendar una llamada/visita con el asesor.`,
    `Si detectas intención fuerte o alguno de estos temas (${triggers}), responde un mensaje breve de transición y termina con el token ${ESCALATE_TOKEN}. No sigas tú.`,
    // BUG 2026-07-24: el "Idioma: ES" del perfil (default del intake) le ganaba a esta
    // regla y el bot contestaba en español a mensajes en inglés. El último mensaje manda.
    "Responde SIEMPRE en el idioma del ÚLTIMO mensaje del cliente: si escribe en inglés contesta en inglés, si escribe en español contesta en español — aunque el idioma registrado del contacto diga otra cosa.",
    `Mensajes cortos, estilo WhatsApp (máx ~${config.maxLines} líneas).`,
    "En WhatsApp la negrita se escribe con UN solo asterisco (*así*). NUNCA uses sintaxis markdown: ni doble asterisco (**negrita**) ni encabezados con #.",
    "Nunca digas que eres una IA salvo pregunta directa; entonces sé honesto.",
  ].join("\n");
}

const DEFAULT_OBJECTIVE =
  "Saluda y avanza en calificar (zona, presupuesto, plazo) con una sola pregunta a la vez.";

// contact/catalog son opcionales: el runner de agentes de fondo (Agent Studio) no
// habla con UN cliente en una conversación 1:1 — opera cross-contact vía tools — así
// que arma marca+tono+objetivo sin esos bloques (ver src/lib/agents/runner.ts).
export function buildSystemPrompt(args: {
  config: BotConfigResolved;
  contact?: { firstName: string; preferredLanguage: string };
  catalog?: Parameters<typeof catalogBrief>[0];
  objective?: string;
}): string {
  const { config, contact, catalog } = args;
  const preset = getTonePreset(config.tonePreset);

  const examples = preset.fewShot
    .map((e) => `${e.role === "user" ? "Cliente" : "Tú"}: ${e.content}`)
    .join("\n");

  const catalogBlock =
    catalog && catalog.length > 0
      ? catalogBrief(catalog)
      : "(No tienes catálogo en contexto: NO cites precios.)";

  const parts = [
    buildBrandRules(config),
    `\nTono y estilo:\n${preset.voiceGuidance}`,
    `\nEjemplos de tu estilo (imítalos en registro, no los copies literal):\n${examples}`,
    `\nObjetivo ahora: ${args.objective ?? DEFAULT_OBJECTIVE}`,
  ];
  if (contact) {
    // "registrado" + "solo referencia": el preferredLanguage suele ser el default ES del
    // intake, no una elección del cliente — no debe leerse como directiva de idioma.
    parts.push(
      `\nCliente: ${contact.firstName} · Idioma registrado: ${contact.preferredLanguage} (solo referencia — responde en el idioma del último mensaje del cliente)`
    );
  }
  parts.push(`\n${catalogBlock}`);

  return parts.join("\n");
}

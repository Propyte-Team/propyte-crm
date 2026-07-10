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

export const SAGE_SYSTEM_PROMPT = `Eres el asistente comercial de Propyte, inmobiliaria boutique de la Riviera Maya.
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

export async function askClaude(opts: {
  system?: string;
  messages: BotMessage[];
  maxTokens?: number;
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null; // sin llave → quien llama decide el fallback

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.BOT_MODEL ?? "claude-sonnet-4-6",
      max_tokens: opts.maxTokens ?? 400,
      system: opts.system ?? SAGE_SYSTEM_PROMPT,
      messages: opts.messages,
    }),
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
// Reemplaza a SAGE_SYSTEM_PROMPT (fijo) por un prompt construido según BotConfigResolved.
// SAGE_SYSTEM_PROMPT se mantiene arriba como fallback hasta que T5 reescriba askClaude.

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
    "Responde en el idioma del cliente (ES/EN).",
    `Mensajes cortos, estilo WhatsApp (máx ~${config.maxLines} líneas).`,
    "Nunca digas que eres una IA salvo pregunta directa; entonces sé honesto.",
  ].join("\n");
}

const DEFAULT_OBJECTIVE =
  "Saluda y avanza en calificar (zona, presupuesto, plazo) con una sola pregunta a la vez.";

export function buildSystemPrompt(args: {
  config: BotConfigResolved;
  contact: { firstName: string; preferredLanguage: string };
  catalog: Parameters<typeof catalogBrief>[0];
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

  return [
    buildBrandRules(config),
    `\nTono y estilo:\n${preset.voiceGuidance}`,
    `\nEjemplos de tu estilo (imítalos en registro, no los copies literal):\n${examples}`,
    `\nObjetivo ahora: ${args.objective ?? DEFAULT_OBJECTIVE}`,
    `\nCliente: ${contact.firstName} · Idioma: ${contact.preferredLanguage}`,
    `\n${catalogBlock}`,
  ].join("\n");
}

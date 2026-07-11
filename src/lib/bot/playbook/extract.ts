// Extracción de campos del playbook desde los mensajes recientes del cliente,
// vía structured output de Claude (Anexo Técnico §B-Task 4).
// Regla de oro: SOLO lo que el cliente dijo EXPLÍCITAMENTE. Si no lo dijo, null.
// Nunca lanza — ante cualquier error/ausencia de llave, regresa {} y quien llama
// decide (capture.ts hace la coerción/validación final, no confía ciegamente en esto).
import type { BotMessage } from "../claude";
import { thinkingFieldFor } from "../claude";

const API_URL = "https://api.anthropic.com/v1/messages";

export interface ExtractTaskLite {
  key: string;
  objective: string;
  captureType: string;
  extractionHint?: string | null;
  enumOptions?: { value: string; synonyms?: string[] }[];
}

function describeTask(task: ExtractTaskLite): string {
  const parts = [task.objective];
  if (task.extractionHint) parts.push(`(${task.extractionHint})`);
  if (task.enumOptions && task.enumOptions.length > 0) {
    const allowed = task.enumOptions
      .map((o) => (o.synonyms && o.synonyms.length > 0 ? `${o.value} [${o.synonyms.join(", ")}]` : o.value))
      .join(", ");
    parts.push(`(valores permitidos: ${allowed})`);
  }
  return parts.join(" ");
}

export function buildExtractionSchema(tasks: ExtractTaskLite[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      tasks.map((t) => [t.key, { type: ["string", "null"], description: describeTask(t) }]),
    ),
    required: tasks.map((t) => t.key),
  };
}

export function parseExtractionResponse(text: string): Record<string, unknown> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

const EXTRACTION_SYSTEM_PROMPT =
  "Eres un extractor. Del ÚLTIMO mensaje del cliente, extrae SOLO lo que el cliente dijo " +
  "EXPLÍCITAMENTE para cada campo. Si no lo dijo, usa null. No inventes ni infieras.";

export async function extractFields(opts: {
  messages: BotMessage[];
  tasks: ExtractTaskLite[];
  model: string;
}): Promise<Record<string, unknown>> {
  if (opts.tasks.length === 0) return {};

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return {};

  const body = {
    model: opts.model,
    max_tokens: 500,
    system: EXTRACTION_SYSTEM_PROMPT,
    output_config: {
      format: {
        type: "json_schema",
        schema: buildExtractionSchema(opts.tasks),
      },
    },
    ...thinkingFieldFor(opts.model),
    messages: opts.messages,
  };

  // Timeout defensivo: esta llamada corre secuencial antes de la respuesta del
  // bot — sin límite, una API lenta puede arrastrar la request completa al
  // 502 de Hostinger (ver feedback_hostinger_long_anthropic_calls).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) return {};

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((b) => b.type === "text")?.text;
    if (!text) return {};

    return parseExtractionResponse(text);
  } catch {
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
}

// Clasificador de tipo de conversación (Frente 4): decide qué segmento (ContactType)
// es quien escribe, para elegir el agente del bot. Mismo patrón defensivo que el
// extractor del playbook: structured output, timeout 4s, NUNCA lanza ni bloquea.
import type { ContactType, Prisma, PrismaClient } from "@prisma/client";
import { thinkingFieldFor } from "./claude";
import type { BotMessage } from "./claude";

const API_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 4000;
export const MAX_CLASSIFY_ATTEMPTS = 3;
/** Valores que el intake pone por default — los únicos que el clasificador puede pisar. */
export const OVERRIDABLE_TYPES: ContactType[] = ["COMPRADOR", "LEAD"];

const CLASSIFIABLE: ContactType[] = [
  "COMPRADOR", "INVERSIONISTA", "BROKER_EXTERNO", "EMPLEO", "REFERIDOR", "CLIENTE",
];

const CLASSIFY_SYSTEM_PROMPT = `Clasifica al remitente de esta conversación con una inmobiliaria (Propyte, Riviera Maya) según su intención EXPLÍCITA:
- COMPRADOR: quiere comprar/rentar una propiedad para uso propio.
- INVERSIONISTA: busca invertir, pregunta por ROI, rentas, plusvalía o preventas como inversión.
- BROKER_EXTERNO: es agente/broker de OTRA inmobiliaria; ofrece propiedades, clientes o alianzas/comisión compartida.
- REFERIDOR: quiere recomendar/referir a alguien más (no compra él).
- EMPLEO: busca trabajo, vacantes o unirse al equipo.
- CLIENTE: dice explícitamente que YA es cliente de Propyte (compró antes / tiene un trato en curso).
Si el mensaje no deja clara la intención todavía, usa UNKNOWN. No adivines.`;

export interface ClassificationResult {
  type: ContactType | null; // null = UNKNOWN / sin señal
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["contactType"],
  properties: {
    contactType: {
      type: "string",
      enum: [...CLASSIFIABLE, "UNKNOWN"],
      description: "Segmento del remitente según su intención explícita en la conversación",
    },
  },
};

/** Clasifica con Claude (structured output). null si UNKNOWN, sin API key o cualquier fallo. */
export async function classifyContactType(opts: {
  messages: BotMessage[];
  model: string;
}): Promise<ContactType | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey || opts.messages.length === 0) return null;

  const body = {
    model: opts.model,
    max_tokens: 100,
    system: CLASSIFY_SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    ...thinkingFieldFor(opts.model),
    messages: opts.messages,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((b) => b.type === "text")?.text;
    if (!text) return null;
    const parsed = JSON.parse(text) as { contactType?: string };
    const t = parsed.contactType;
    return t && t !== "UNKNOWN" && (CLASSIFIABLE as string[]).includes(t) ? (t as ContactType) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

interface ClassifyMarker {
  type?: string | null;
  attempts?: number;
  at?: string;
}

/**
 * Clasifica una vez por contacto (marker en custom.bot_classification, máx. 3 intentos).
 * Solo pisa contactType si el valor actual es un default del intake (COMPRADOR/LEAD) —
 * jamás sobrescribe lo que puso un humano. Escritura auditada (source bot_classifier).
 * Devuelve el ContactType efectivo a usar para elegir agente. NUNCA lanza.
 */
export async function maybeClassifyContact(
  db: PrismaClient,
  contact: { id: string; contactType: ContactType; assignedToId: string | null; custom: unknown },
  messages: BotMessage[],
  model: string
): Promise<ContactType> {
  try {
    const custom =
      typeof contact.custom === "object" && contact.custom !== null && !Array.isArray(contact.custom)
        ? (contact.custom as Record<string, unknown>)
        : {};
    const marker = (custom.bot_classification ?? {}) as ClassifyMarker;

    // Ya clasificado, agotado, o valor puesto por humano → no gastar llamadas
    if (marker.type) return contact.contactType;
    if ((marker.attempts ?? 0) >= MAX_CLASSIFY_ATTEMPTS) return contact.contactType;
    if (!OVERRIDABLE_TYPES.includes(contact.contactType)) return contact.contactType;

    const detected = await classifyContactType({ messages, model });
    const attempts = (marker.attempts ?? 0) + 1;
    const newMarker: ClassifyMarker = {
      type: detected ?? null,
      attempts,
      at: new Date().toISOString(),
    };
    const newCustom = { ...custom, bot_classification: newMarker };

    if (!detected || detected === contact.contactType) {
      // sin señal (o coincide): solo persistir el intento
      await db.contact.update({ where: { id: contact.id }, data: { custom: newCustom as unknown as Prisma.InputJsonValue } });
      return contact.contactType;
    }

    // Escritura auditada: cronología (GUC) + AuditLog, mismo patrón que apply.ts
    const admin = contact.assignedToId
      ? { id: contact.assignedToId }
      : await db.user.findFirst({
          where: { role: "ADMIN", isActive: true, deletedAt: null },
          select: { id: true },
        });
    if (!admin) {
      await db.contact.update({ where: { id: contact.id }, data: { custom: newCustom as unknown as Prisma.InputJsonValue } });
      return contact.contactType;
    }

    const { setChangeSource } = await import("@/lib/audit/change-context");
    await db.$transaction(async (tx) => {
      await setChangeSource(tx, { source: "bot_classifier", actorId: admin.id });
      await tx.contact.update({
        where: { id: contact.id },
        data: { contactType: detected, custom: newCustom as unknown as Prisma.InputJsonValue },
      });
      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: "UPDATE",
          entity: "Contact",
          entityId: contact.id,
          changes: { field: "contactType", from: contact.contactType, to: detected, source: "bot_classifier" },
        },
      });
    });
    return detected;
  } catch (err) {
    console.warn(`[bot] clasificador falló (${contact.id}):`, err);
    return contact.contactType;
  }
}

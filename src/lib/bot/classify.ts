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
 * Clasifica un contacto (marker en custom.bot_classification) y sigue vigilando
 * cambios de intención después de la primera clasificación real.
 *
 * FIX 2026-09-21 (hallazgo de Luis): antes, en cuanto `marker.type` quedaba puesto la
 * clasificación se congelaba para siempre — un contacto que cambiaba de intención a
 * media conversación (p.ej. de EMPLEO a INVERSIONISTA) se quedaba archivado en el
 * primer tipo detectado, y el bot seguía respondiendo con la identidad vieja. Ahora
 * solo se congela cuando el contactType actual YA NO coincide con lo último que
 * escribió el bot (`marker.type !== contact.contactType`): eso es señal de que alguien
 * más — un humano — lo cambió después, y esa decisión sí se respeta sin volver a
 * clasificar. Mientras el bot sea "dueño" del valor actual, se reevalúa en cada
 * mensaje; es el único costo real (una llamada de clasificación más por mensaje para
 * contactos ya clasificados), igual al que ya se paga hoy por cada LEAD/COMPRADOR sin
 * clasificar.
 *
 * El tope de `MAX_CLASSIFY_ATTEMPTS` sigue aplicando, pero solo mientras NO hay ninguna
 * señal todavía (evita gastar llamadas en un contacto que nunca deja clara su
 * intención); una vez que hay un tipo real, no hay tope — se vigila indefinidamente.
 *
 * Solo pisa contactType si el valor actual es un default del intake (COMPRADOR/LEAD) o
 * si el bot es dueño del valor actual — jamás sobrescribe lo que puso un humano.
 * Escritura auditada (source bot_classifier). Devuelve el ContactType efectivo a usar
 * para elegir agente. NUNCA lanza.
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

    // El bot es "dueño" del valor actual si nunca ha clasificado nada (marker.type sin
    // poner) o si lo último que escribió sigue vigente. Si no, alguien más lo tocó
    // después del último write del bot → se respeta esa decisión, no se vuelve a tocar.
    const botOwnsCurrentType = !marker.type || marker.type === contact.contactType;
    if (!botOwnsCurrentType) return contact.contactType;

    // Sin clasificación del bot todavía: solo tiene sentido intentar sobre defaults del
    // intake (COMPRADOR/LEAD). Si ya es un tipo real puesto por otra vía, no se toca.
    if (!marker.type && !OVERRIDABLE_TYPES.includes(contact.contactType)) return contact.contactType;

    // El tope de intentos solo aplica en fase "sin clasificar todavía".
    if (!marker.type && (marker.attempts ?? 0) >= MAX_CLASSIFY_ATTEMPTS) return contact.contactType;

    const detected = await classifyContactType({ messages, model });

    if (!detected || detected === contact.contactType) {
      // Sin señal, o confirma el tipo actual: nada que cambiar. Solo se actualiza el
      // contador de intentos mientras seguimos en fase "sin clasificar todavía"; una
      // vez que ya hay un tipo real no hace falta escribir nada en cada reconfirmación.
      if (!marker.type) {
        const newMarker: ClassifyMarker = {
          type: detected ?? null,
          attempts: (marker.attempts ?? 0) + 1,
          at: new Date().toISOString(),
        };
        await db.contact.update({
          where: { id: contact.id },
          data: { custom: { ...custom, bot_classification: newMarker } as unknown as Prisma.InputJsonValue },
        });
      }
      return contact.contactType;
    }

    // Cambio de segmento detectado (primera clasificación real, o corrección de
    // intención sobre una clasificación previa del propio bot). El contador de
    // intentos ya no se vuelve a consultar una vez que hay tipo real (ver arriba);
    // se sigue incrementando solo por continuidad con el historial del marker.
    const newMarker: ClassifyMarker = {
      type: detected,
      attempts: (marker.attempts ?? 0) + 1,
      at: new Date().toISOString(),
    };
    const newCustom = { ...custom, bot_classification: newMarker };

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

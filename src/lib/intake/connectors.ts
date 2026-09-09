// Servicio de conectores de leads (Anexo B §H) — idempotencia por connector_lead_logs,
// mapeo fieldMap → IncomingLead, credenciales cifradas (lib/crypto).
import prisma from "@/lib/db";
import type { LeadConnector, Prisma } from "@prisma/client";
import { decryptPII, encryptPII } from "@/lib/crypto";
import { normalizePhoneE164 } from "@/lib/phone";
import { deriveInvestmentProfile } from "./profile-mapping";
import { captureLead } from "./capture-lead";

export function readCredentials<T = Record<string, string>>(connector: LeadConnector): T | null {
  if (!connector.credentials) return null;
  try {
    return JSON.parse(decryptPII(connector.credentials) ?? "{}") as T;
  } catch {
    return null;
  }
}

export function writeCredentials(creds: Record<string, unknown>): string {
  return encryptPII(JSON.stringify(creds))!;
}

// fieldMap: { "<campo externo>": "<campo IncomingLead>" }. Soporta "fullName" (se parte
// en firstName/lastName) y caída a sourceDetail para preguntas custom no mapeadas.
export function mapExternalFields(
  fieldMap: Record<string, string>,
  external: Record<string, unknown>
): Record<string, unknown> {
  const lead: Record<string, unknown> = {};
  const extras: string[] = [];

  for (const [extKey, rawValue] of Object.entries(external)) {
    const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
    if (value == null || value === "") continue;
    const target = fieldMap[extKey];
    if (!target) {
      extras.push(`${extKey}: ${String(value).slice(0, 80)}`);
      continue;
    }
    if (target === "fullName" && typeof value === "string") {
      const parts = value.split(/\s+/);
      lead.firstName = parts[0];
      lead.lastName = parts.slice(1).join(" ") || "(sin apellido)";
    } else {
      lead[target] = value;
    }
  }
  if (extras.length > 0) {
    lead.sourceDetail = [lead.sourceDetail, extras.join(" · ")].filter(Boolean).join(" · ").slice(0, 200);
  }
  return lead;
}

// Enums válidos de Contact (deben coincidir EXACTO con incomingLeadSchema en
// src/lib/validations/rebuild-f1.ts — `source` es un subconjunto documentado ahí).
export const VALID_ENUMS: Record<string, readonly string[]> = {
  contactType: ["COMPRADOR", "INVERSIONISTA", "BROKER_EXTERNO", "EMPLEO", "REFERIDOR", "LEAD", "PROSPECTO", "CLIENTE", "REFERIDO"],
  temperature: ["HOT", "WARM", "COLD", "DEAD"],
  language: ["ES", "EN"],
  source: [
    "WALK_IN", "FACEBOOK_ADS", "GOOGLE_ADS", "INSTAGRAM", "TIKTOK_ADS", "LINKEDIN",
    "PORTAL_INMOBILIARIO", "REFERIDO_CLIENTE", "REFERIDO_BROKER", "LLAMADA_FRIA",
    "EVENTO", "WEBSITE", "WHATSAPP", "MESSENGER", "OTRO",
  ],
  investmentProfile: ["END_USER", "INVESTOR_RENTAL", "INVESTOR_FLIP", "INVESTOR_LAND", "MIXED"],
  propertyType: ["DEPARTAMENTO", "CASA", "TERRENO", "MACROLOTE", "LOCAL_COMERCIAL", "OTRO"],
  purchaseTimeline: ["IMMEDIATE", "ONE_TO_THREE_MONTHS", "THREE_TO_SIX_MONTHS", "SIX_PLUS_MONTHS"],
  paymentMethod: ["CONTADO", "CREDITO_HIPOTECARIO", "FINANCIAMIENTO_DIRECTO", "MIXTO"],
  purchaseModality: ["PREVENTA", "ENTREGA_INMEDIATA", "REVENTA", "ABIERTO"],
  rentalStrategy: ["LONG_TERM", "AIRBNB", "BOTH", "NA"],
};

// Elimina de `fields` los valores de enum inválidos (mutando) y devuelve los descartados
// como "campo=valor". Un enum malo NO debe tumbar el lead (mismo criterio que el teléfono);
// el valor crudo ya se preserva en Contact.custom.
export function sanitizeEnumFields(fields: Record<string, unknown>): string[] {
  const dropped: string[] = [];
  for (const [key, valid] of Object.entries(VALID_ENUMS)) {
    const v = fields[key];
    if (typeof v === "string" && v !== "" && !valid.includes(v)) {
      dropped.push(`${key}=${v}`);
      delete fields[key];
    }
  }
  return dropped;
}

// Rellena en `fields` SOLO las claves que vengan undefined/null/"" con el valor heurístico
// de `profileFields` (deriveInvestmentProfile). El mapeo explícito del conector siempre gana
// sobre el heurístico — nunca lo pisa. Pura, sin BD, testeable en aislamiento.
export function mergeProfileDefaults(
  fields: Record<string, unknown>,
  profileFields: Record<string, unknown>
): Record<string, unknown> {
  for (const [k, v] of Object.entries(profileFields)) {
    if (fields[k] === undefined || fields[k] === null || fields[k] === "") fields[k] = v;
  }
  return fields;
}

/**
 * Señal de vida de un conector: `lastLeadAt` cuando entregó, `errorCount`/`lastError`
 * cuando lo que entregó no se pudo ingerir.
 *
 * Existe como función y no como `update` inline porque hay DOS vías de entrega y solo
 * una escribía. `processIncomingLead` (formularios de anuncio) la escribía; el intake de
 * DM —hoy la única vía por la que llegan prospectos de INSTAGRAM/MESSENGER— no la tocaba
 * nunca. El resultado era que un conector de DM caído se veía IDÉNTICO a uno sano:
 * `ultimo_lead: null` y cero errores desde siempre, que es justo lo que crm_pulso lee
 * para decidir si un conector está vivo.
 *
 * Best-effort a propósito: la señal de vida NUNCA debe tumbar la ingesta del lead que la
 * produjo. Si esta escritura falla se pierde una marca de monitoreo, no un prospecto.
 * (Antes no era así: un fallo de este update dentro de `processIncomingLead` caía al
 * catch y marcaba como ERROR un lead que sí se había capturado.)
 */
export async function markConnectorLead(connectorId: string, error?: string | null): Promise<void> {
  try {
    await prisma.leadConnector.update({
      where: { id: connectorId },
      data: error
        ? { errorCount: { increment: 1 }, lastError: error.slice(0, 1000) }
        : { lastLeadAt: new Date(), errorCount: 0, lastError: null },
    });
  } catch (err) {
    console.error(`[connectors] señal de vida no escrita (${connectorId}):`, err);
  }
}

/**
 * Clave donde viajan los campos ya mapeados dentro de `rawPayload` (#713). Empieza con
 * guion bajo para no chocar nunca con un campo del formulario del anunciante.
 */
export const CAMPOS_MAPEADOS = "_mapped";

/**
 * Reserva el lugar de un lead entrante ANTES de hacer nada que pueda fallar (#713).
 *
 * El agujero que cierra: el webhook de Meta pedía el detalle del lead a Graph *antes* de
 * registrar nada. Si ese token había caducado —los de Página duran ~60 días y aquí no se
 * renuevan—, no quedaba ni una fila: ni el id del lead, ni el payload, ni rastro de que
 * hubiera existido. El lead, ya pagado, desaparecía en silencio.
 *
 * Reservando primero, un fallo posterior deja una fila en ERROR que se puede reprocesar y
 * que además se ve en el panel.
 *
 * `yaProcesado` distingue el reintento legítimo del duplicado: si la fila existe pero
 * quedó en ERROR o sin terminar, se devuelve para volver a intentarlo. Antes CUALQUIER
 * fila existente cortaba el reintento, así que un lead que falló una vez quedaba
 * bloqueado para siempre por su propia marca de idempotencia.
 */
export async function reservarLeadEntrante(
  connectorId: string,
  externalLeadId: string,
  rawPayload: Record<string, unknown>
): Promise<{ logId: string; yaProcesado: boolean }> {
  try {
    const log = await prisma.connectorLeadLog.create({
      data: {
        connectorId,
        externalLeadId,
        rawPayload: rawPayload as Prisma.InputJsonValue,
        status: "RECEIVED",
      },
    });
    return { logId: log.id, yaProcesado: false };
  } catch (err: unknown) {
    if (typeof err === "object" && err && (err as { code?: string }).code !== "P2002") throw err;
  }

  const existente = await prisma.connectorLeadLog.findUnique({
    where: { connectorId_externalLeadId: { connectorId, externalLeadId } },
  });
  if (!existente) throw new Error("El log del lead desapareció entre el create y la lectura");

  // PROCESSED y DUPLICATE ya llegaron a un contacto: no hay nada que rehacer.
  const terminado = existente.status === "PROCESSED" || existente.status === "DUPLICATE";
  return { logId: existente.id, yaProcesado: terminado };
}

/** Marca la reserva como fallida cuando el fallo ocurre fuera de processIncomingLead. */
export async function marcarLeadFallido(
  logId: string,
  connectorId: string,
  detalle: string
): Promise<void> {
  await prisma.connectorLeadLog.update({
    where: { id: logId },
    data: { status: "ERROR", errorDetail: detalle.slice(0, 1000), processedAt: new Date() },
  }).catch((err) => console.error(`[connectors] no se pudo marcar el fallo ${logId}:`, err));
  await markConnectorLead(connectorId, detalle);
}

// Punto único de entrada de un lead externo. Idempotente: el UNIQUE
// (connectorId, externalLeadId) garantiza que un retry no duplica.
export async function processIncomingLead(
  connectorId: string,
  externalLeadId: string,
  rawPayload: Record<string, unknown>,
  mappedFields: Record<string, unknown>
): Promise<{ status: string; contactId?: string }> {
  // 1. Log primero (claim de idempotencia)
  const reserva = await reservarLeadEntrante(connectorId, externalLeadId, rawPayload);
  if (reserva.yaProcesado) return { status: "ALREADY_PROCESSED" };
  const logId = reserva.logId;

  // 2. Capturar
  const connector = await prisma.leadConnector.findUnique({ where: { id: connectorId } });
  const config = (connector?.config ?? {}) as { defaultLeadSource?: string };
  const PROVIDER_SOURCE: Record<string, string> = {
    META: "FACEBOOK_ADS",
    INSTAGRAM: "INSTAGRAM",
    MESSENGER: "MESSENGER",
    TIKTOK: "TIKTOK_ADS",
    GOOGLE_ADS: "GOOGLE_ADS",
    LINKEDIN: "LINKEDIN",
  };
  // Default de `source` si el mapeo no trae uno usable (no depende de mappedFields.source,
  // así una regla que puso un valor INVÁLIDO puede recaer aquí tras sanitizar más abajo).
  const sourceDefault =
    config.defaultLeadSource ?? (connector?.provider ? PROVIDER_SOURCE[connector.provider] ?? "WEBSITE" : "WEBSITE");
  const source = (mappedFields.source as string | undefined) ?? sourceDefault;

  // Copia local: no mutamos el objeto del caller (en sitio/portal es el request body).
  const fields: Record<string, unknown> = { ...mappedFields, source };
  // Teléfono inválido NO debe tumbar el lead: se descarta el campo (el valor crudo se
  // conserva en `custom`). Un solo campo malformado no debe perder todo el lead.
  if (typeof fields.phone === "string" && !normalizePhoneE164(fields.phone)) {
    delete fields.phone;
  }
  // Un enum inválido de una regla de mapeo tampoco debe tumbar el lead (mismo criterio
  // que el teléfono): se descarta SOLO ese campo. `source` es requerido — si la regla
  // le puso un valor inválido y se descartó, se recae al default del conector/proveedor
  // (nunca queda sin valor).
  sanitizeEnumFields(fields);
  if (typeof fields.source !== "string" || fields.source === "") {
    fields.source = sourceDefault;
  }
  // Todos los campos crudos del formulario → Contact.custom (no se pierde nada de info).
  const custom = rawPayload.external as Record<string, unknown> | undefined;
  // Perfil de Inversión: normaliza respuestas del form a los enums del CRM (camino A).
  const { budgetCurrency, ...profileFields } = custom ? deriveInvestmentProfile(custom) : {};
  mergeProfileDefaults(fields, profileFields);
  if (custom && Object.keys(custom).length) {
    fields.custom = budgetCurrency ? { ...custom, budget_currency: budgetCurrency } : custom;
  }

  try {
    const result = await captureLead(fields, { connectorId });
    const status = result.error ? "ERROR" : result.isNew ? "PROCESSED" : "DUPLICATE";
    await prisma.connectorLeadLog.update({
      where: { id: logId },
      data: {
        status,
        contactId: result.contactId,
        errorDetail: result.error ?? null,
        processedAt: new Date(),
        // #713: los campos ya mapeados viajan junto al crudo. Sin esto, reprocesar un
        // lead fallido obligaría a volver a pedírselo al proveedor —y el token que
        // falló suele ser justo el que no está disponible.
        rawPayload: { ...rawPayload, [CAMPOS_MAPEADOS]: fields } as Prisma.InputJsonValue,
      },
    });
    await markConnectorLead(connectorId, result.error);
    return { status, contactId: result.contactId ?? undefined };
  } catch (err) {
    const detail = String(err instanceof Error ? err.message : err).slice(0, 1000);
    await prisma.connectorLeadLog.update({
      where: { id: logId },
      data: { status: "ERROR", errorDetail: detail, processedAt: new Date() },
    });
    await markConnectorLead(connectorId, detail);
    return { status: "ERROR" };
  }
}

/**
 * Reprocesa los leads que quedaron en ERROR sin llegar a contacto (#713).
 *
 * El modelo `ConnectorLeadLog` prometía «idempotencia + replay» en su comentario desde el
 * principio, pero el replay no existía: una fila en ERROR se quedaba ahí para siempre y
 * nadie la miraba. Esto es la mitad que faltaba.
 *
 * Solo reprocesa lo que puede reprocesar solo: las filas que guardaron sus campos ya
 * mapeados. Un lead que falló ANTES del mapeo —porque el token del proveedor había
 * caducado— no se puede rehacer sin volver a pedírselo al proveedor, y esa recuperación
 * es la que cubre el 5xx del webhook: el proveedor reintenta por su cuenta. Esas filas se
 * quedan visibles en ERROR, que es exactamente lo que se quería: dejan de ser invisibles.
 */
export async function reprocesarLeadsFallidos(limite = 25): Promise<{
  intentados: number;
  recuperados: number;
}> {
  const fallidos = await prisma.connectorLeadLog.findMany({
    where: { status: "ERROR", contactId: null },
    orderBy: { receivedAt: "asc" },
    take: limite,
  });

  let recuperados = 0;
  let intentados = 0;

  for (const fila of fallidos) {
    const crudo = (fila.rawPayload ?? {}) as Record<string, unknown>;
    const mapeados = crudo[CAMPOS_MAPEADOS] as Record<string, unknown> | undefined;
    if (!mapeados || typeof mapeados !== "object") continue; // necesita al proveedor

    intentados++;
    const { [CAMPOS_MAPEADOS]: _omitido, ...sinMapeados } = crudo;
    try {
      const r = await processIncomingLead(
        fila.connectorId,
        fila.externalLeadId,
        sinMapeados,
        mapeados
      );
      if (r.status === "PROCESSED" || r.status === "DUPLICATE") recuperados++;
    } catch (err) {
      console.error(`[connectors] replay del lead ${fila.externalLeadId} falló:`, err);
    }
  }

  return { intentados, recuperados };
}

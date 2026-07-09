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

// Punto único de entrada de un lead externo. Idempotente: el UNIQUE
// (connectorId, externalLeadId) garantiza que un retry no duplica.
export async function processIncomingLead(
  connectorId: string,
  externalLeadId: string,
  rawPayload: Record<string, unknown>,
  mappedFields: Record<string, unknown>
): Promise<{ status: string; contactId?: string }> {
  // 1. Log primero (claim de idempotencia)
  let logId: string;
  try {
    const log = await prisma.connectorLeadLog.create({
      data: {
        connectorId,
        externalLeadId,
        rawPayload: rawPayload as Prisma.InputJsonValue,
        status: "RECEIVED",
      },
    });
    logId = log.id;
  } catch (err: unknown) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
      return { status: "ALREADY_PROCESSED" };
    }
    throw err;
  }

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
  const source =
    (mappedFields.source as string | undefined) ??
    config.defaultLeadSource ??
    (connector?.provider ? PROVIDER_SOURCE[connector.provider] ?? "WEBSITE" : "WEBSITE");

  // Copia local: no mutamos el objeto del caller (en sitio/portal es el request body).
  const fields: Record<string, unknown> = { ...mappedFields, source };
  // Teléfono inválido NO debe tumbar el lead: se descarta el campo (el valor crudo se
  // conserva en `custom`). Un solo campo malformado no debe perder todo el lead.
  if (typeof fields.phone === "string" && !normalizePhoneE164(fields.phone)) {
    delete fields.phone;
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
      },
    });
    await prisma.leadConnector.update({
      where: { id: connectorId },
      data: result.error
        ? { errorCount: { increment: 1 }, lastError: result.error }
        : { lastLeadAt: new Date(), errorCount: 0, lastError: null },
    });
    return { status, contactId: result.contactId ?? undefined };
  } catch (err) {
    const detail = String(err instanceof Error ? err.message : err).slice(0, 1000);
    await prisma.connectorLeadLog.update({
      where: { id: logId },
      data: { status: "ERROR", errorDetail: detail, processedAt: new Date() },
    });
    await prisma.leadConnector.update({
      where: { id: connectorId },
      data: { errorCount: { increment: 1 }, lastError: detail },
    });
    return { status: "ERROR" };
  }
}

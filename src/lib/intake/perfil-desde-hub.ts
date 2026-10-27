// Perfil de inversión desde los leads de Meta del Hub (real_estate_hub.meta_leads).
//
// Por qué: los leads de formularios de Meta entran por el conector del Hub y van a Zoho; el CRM
// no los recibe por su webhook. Así, los contactos del CRM llegaban sin plazo, forma de pago,
// interés ni presupuesto (medido 2026-10-27: 18 / 19 / 1 / 1 de 323 compradores), y el lead score
// no tenía con qué calcular la familia «perfil». Las respuestas sí existen en la tabla del Hub,
// que vive en la misma base: aquí se ligan y se copian.
//
// Reglas:
//  - SOLO llena huecos: nunca pisa un valor que ya puso un asesor, el bot o el intake (COALESCE
//    en el mismo UPDATE, así una edición concurrente tampoco se pisa).
//  - Liga por, en este orden de confianza: id de Zoho → correo → últimos 10 dígitos del teléfono.
//    Si hay varios leads del contacto, usa el más reciente.
//  - Deja marca en custom.perfilMetaLeadId: cada lead se procesa una vez, aunque no aporte nada.
//  - Toca `updatedAt`, así el lead score lo recalcula en el siguiente tick (lo marca «sucio»).
//  - Lo que traduce deriveInvestmentProfile (profile-mapping.ts) — las mismas reglas del intake.
import prisma from "@/lib/db";
import { withChangeSource } from "@/lib/audit/change-context";
import { CLAVES_PERFIL, deriveInvestmentProfile, type DerivedProfile } from "./profile-mapping";

/** Origen con que estos cambios aparecen en la cronología de la ficha. */
export const ORIGEN_CAMBIO = "perfil_meta_hub";

// Solo cuentan los leads que respondieron alguna pregunta de perfil. Por nombre exacto: un patrón
// como «interes» atrapaba «¿tienes_clientes_interesados…?» de los formularios de brokers.
const PREGUNTAS_PERFIL: string[] = Object.values(CLAVES_PERFIL).flat();

export interface CandidatoPerfil {
  contactId: string;
  metaLeadId: string;
  via: "zoho" | "correo" | "telefono";
  budget: string | null;
  urgency: string | null;
  acquisition: string | null;
  rawFieldData: unknown;
  /** Qué campos del contacto están vacíos HOY. */
  faltaPlazo: boolean;
  faltaPago: boolean;
  faltaPerfil: boolean;
  faltaPresupuesto: boolean;
}

export interface CambiosPerfil {
  purchaseTimeline: DerivedProfile["purchaseTimeline"] | null;
  paymentMethod: DerivedProfile["paymentMethod"] | null;
  investmentProfile: DerivedProfile["investmentProfile"] | null;
  budgetMin: number | null;
  budgetMax: number | null;
  /** Lo que se fusiona a `custom` (marca + moneda del presupuesto si se llenó). */
  custom: Record<string, unknown>;
  /** Nombres de los campos que de verdad se llenan (para el conteo y el log). */
  llenados: string[];
}

/** Respuestas del formulario como `{ pregunta: primer valor }`, más las columnas del Hub. */
export function respuestasDe(c: Pick<CandidatoPerfil, "budget" | "urgency" | "acquisition" | "rawFieldData">): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Array.isArray(c.rawFieldData)) {
    for (const f of c.rawFieldData as Array<{ name?: unknown; values?: unknown }>) {
      const v = Array.isArray(f?.values) ? f.values[0] : undefined;
      if (typeof f?.name === "string" && typeof v === "string" && v.trim()) out[f.name] = v;
    }
  }
  // Las columnas van al final: si el formulario trae la pregunta, gana la respuesta cruda.
  if (c.budget && out.budget === undefined) out.budget = c.budget;
  if (c.urgency && out.urgency === undefined) out.urgency = c.urgency;
  if (c.acquisition && out.acquisition === undefined) out.acquisition = c.acquisition;
  return out;
}

/** Pura: qué se escribe en el contacto. Solo campos que hoy están vacíos. */
export function cambiosPerfil(c: CandidatoPerfil, ahora: Date = new Date()): CambiosPerfil {
  const d = deriveInvestmentProfile(respuestasDe(c));
  const llenados: string[] = [];
  const cambios: CambiosPerfil = {
    purchaseTimeline: null,
    paymentMethod: null,
    investmentProfile: null,
    budgetMin: null,
    budgetMax: null,
    custom: { perfilMetaLeadId: c.metaLeadId, perfilMetaVia: c.via, perfilMetaAt: ahora.toISOString() },
    llenados,
  };
  if (c.faltaPlazo && d.purchaseTimeline) {
    cambios.purchaseTimeline = d.purchaseTimeline;
    llenados.push("purchaseTimeline");
  }
  if (c.faltaPago && d.paymentMethod) {
    cambios.paymentMethod = d.paymentMethod;
    llenados.push("paymentMethod");
  }
  if (c.faltaPerfil && d.investmentProfile) {
    cambios.investmentProfile = d.investmentProfile;
    llenados.push("investmentProfile");
  }
  if (c.faltaPresupuesto && (d.budgetMin !== undefined || d.budgetMax !== undefined)) {
    cambios.budgetMin = d.budgetMin ?? null;
    cambios.budgetMax = d.budgetMax ?? null;
    // Sin moneda el score asume MXN; con moneda se guarda donde la lee el intake.
    if (d.budgetCurrency) cambios.custom.budget_currency = d.budgetCurrency;
    llenados.push("presupuesto");
  }
  return cambios;
}

/**
 * Contactos con algún hueco de perfil y un lead de Meta en el Hub que todavía no se procesó.
 * Se elige el lead MÁS RECIENTE del contacto y solo después se filtra la marca: si se filtrara
 * antes, un contacto con dos leads alternaría entre ellos en cada corrida.
 */
async function candidatos(limite: number): Promise<CandidatoPerfil[]> {
  return prisma.$queryRaw<CandidatoPerfil[]>`
    WITH c AS (
      SELECT "id", "zohoId", "custom",
             lower(trim("email")) AS mail,
             right(regexp_replace(coalesce("phone", ''), '\\D', '', 'g'), 10) AS tel,
             "purchaseTimeline" IS NULL AS "faltaPlazo",
             "paymentMethod" IS NULL AS "faltaPago",
             "investmentProfile" IS NULL AS "faltaPerfil",
             ("budgetMin" IS NULL AND "budgetMax" IS NULL) AS "faltaPresupuesto"
        FROM "propyte_crm"."contacts"
       WHERE "deletedAt" IS NULL AND "mergedIntoId" IS NULL
         AND ("purchaseTimeline" IS NULL OR "paymentMethod" IS NULL OR "investmentProfile" IS NULL
              OR ("budgetMin" IS NULL AND "budgetMax" IS NULL))
    ),
    ligados AS (
      SELECT DISTINCT ON (c."id")
             c."id" AS "contactId", ml."meta_lead_id" AS "metaLeadId",
             CASE WHEN ml."matched_zoho_id" = c."zohoId" THEN 'zoho'
                  WHEN c.mail LIKE '%@%' AND lower(trim(ml."email")) = c.mail THEN 'correo'
                  ELSE 'telefono' END AS "via",
             ml."budget", ml."urgency", ml."acquisition", ml."raw_field_data" AS "rawFieldData",
             c."faltaPlazo", c."faltaPago", c."faltaPerfil", c."faltaPresupuesto",
             c."custom"->>'perfilMetaLeadId' AS marca
        -- '\\D' (doble barra): dentro del template de Prisma una sola barra se pierde y quedaría 'D'.
        FROM c
        JOIN "real_estate_hub"."meta_leads" ml
          ON (ml."matched_zoho_id" IS NOT NULL AND ml."matched_zoho_id" = c."zohoId")
          OR (c.mail LIKE '%@%' AND lower(trim(ml."email")) = c.mail)
          OR (length(c.tel) = 10 AND right(regexp_replace(coalesce(ml."phone", ''), '\\D', '', 'g'), 10) = c.tel)
       WHERE ml."budget" IS NOT NULL OR ml."urgency" IS NOT NULL OR ml."acquisition" IS NOT NULL
          OR EXISTS (
               SELECT 1
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ml."raw_field_data") = 'array'
                                                THEN ml."raw_field_data" ELSE '[]'::jsonb END) f
                WHERE f->>'name' = ANY(${PREGUNTAS_PERFIL}::text[]))
       ORDER BY c."id", ml."created_on_meta" DESC NULLS LAST, ml."created_at" DESC
    )
    SELECT "contactId", "metaLeadId", "via", "budget", "urgency", "acquisition", "rawFieldData",
           "faltaPlazo", "faltaPago", "faltaPerfil", "faltaPresupuesto"
      FROM ligados
     WHERE coalesce(marca, '') <> "metaLeadId"
     LIMIT ${limite}`;
}

async function aplicar(contactId: string, c: CambiosPerfil): Promise<void> {
  // COALESCE: si alguien llenó el campo entre la lectura y esta escritura, se queda lo suyo.
  // El presupuesto se escribe en pareja y solo si los dos siguen vacíos.
  // En la misma transacción que fija crm.source, para que la cronología diga de dónde vino.
  await withChangeSource({ source: ORIGEN_CAMBIO }, (tx) => tx.$executeRaw`
    UPDATE "propyte_crm"."contacts" SET
      "purchaseTimeline"  = COALESCE("purchaseTimeline", ${c.purchaseTimeline}::"propyte_crm"."PurchaseTimeline"),
      "paymentMethod"     = COALESCE("paymentMethod", ${c.paymentMethod}::"propyte_crm"."PaymentMethod"),
      "investmentProfile" = COALESCE("investmentProfile", ${c.investmentProfile}::"propyte_crm"."InvestmentProfile"),
      "budgetMin" = CASE WHEN "budgetMin" IS NULL AND "budgetMax" IS NULL THEN ${c.budgetMin}::numeric ELSE "budgetMin" END,
      "budgetMax" = CASE WHEN "budgetMin" IS NULL AND "budgetMax" IS NULL THEN ${c.budgetMax}::numeric ELSE "budgetMax" END,
      "custom" = coalesce("custom", '{}'::jsonb) || ${JSON.stringify(c.custom)}::jsonb,
      "updatedAt" = now()
    WHERE "id" = ${contactId}`);
}

/** Tick del cron: liga y llena hasta `limite` contactos. */
export async function completarPerfilDesdeHub(limite = 50): Promise<{ revisados: number; completados: number; campos: number }> {
  const lista = await candidatos(limite);
  let completados = 0;
  let campos = 0;
  for (const cand of lista) {
    const cambios = cambiosPerfil(cand);
    await aplicar(cand.contactId, cambios);
    if (cambios.llenados.length > 0) {
      completados++;
      campos += cambios.llenados.length;
    }
  }
  return { revisados: lista.length, completados, campos };
}

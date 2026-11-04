// #973 — Recálculo de la temperatura. Lo corre el cron de workflows cada minuto, por lotes (igual
// que el lead score, lib/scoring/recalcular.ts).
//
// Qué recalcula en cada tick, en este orden:
//   1. «Sucios»: sin fila en contact_temperaturas, editados después del último cálculo, o con un
//      mensaje o una actividad nueva después del último cálculo (un mensaje no toca contacts).
//   2. «Viejos»: calculados hace más de una hora, para que las ventanas de 72 h, 7, 30 y 60 días
//      corran solas.
//
// Escribe la fila de contact_temperaturas siempre, y contacts.temperature SOLO si cambió: con SQL
// directo (no mueve updatedAt, así el contacto no vuelve a quedar «sucio») y con la fuente
// copilot_temperatura en la cronología.
import prisma from "@/lib/db";
import { Prisma } from "@prisma/client";
import { withChangeSource } from "@/lib/audit/change-context";
import { calcularTemperatura, SENAL_DE_COMPRA, VENTANA_SENAL_MS } from "./temperatura";

const HORA = 3_600_000;
export const FUENTE_CAMBIO_TEMPERATURA = "copilot_temperatura";

/** Actividades que son una respuesta del lead. Una llamada saliente cuenta si duró ≥ 30 s (#945). */
const ACTIVIDADES_DE_RESPUESTA = ["CALL_INBOUND", "WHATSAPP_IN", "SMS_IN", "EMAIL_RECEIVED", "INSTAGRAM_IN", "MESSENGER_IN", "WALK_IN"];
/** Actividades que son una cita agendada (señal de compra si se crearon en las últimas 72 h). */
const ACTIVIDADES_DE_CITA = ["MEETING_VIRTUAL", "MEETING_PRESENTIAL", "MEETING_SHOWROOM", "DISCOVERY_CALL"];
const ESTADOS_DE_CITA = ["REUNION", "DEMO", "RECORRIDO"];
/** Fuentes de cronología que no cuentan como señal: llenados, migraciones y correcciones. */
export const FUENTES_QUE_NO_SON_SENAL = ["%llenado%", "%migracion%", "ui_correccion_estado"];

/** El patrón de señales en la sintaxis de Postgres (~*): la misma lista que SENAL_DE_COMPRA. */
export function patronSenalPostgres(): string {
  // JS usa \b; Postgres usa \y para el borde de palabra. Sin bandera /i (se usa ~*).
  return SENAL_DE_COMPRA.source.replace(/\\b/g, "\\y");
}

async function idsSucios(limite: number): Promise<string[]> {
  if (limite <= 0) return [];
  const filas = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c."id"
      FROM "propyte_crm"."contacts" c
      LEFT JOIN "propyte_crm"."contact_temperaturas" t ON t."contactId" = c."id"
     WHERE c."deletedAt" IS NULL AND c."mergedIntoId" IS NULL
       AND (t."contactId" IS NULL
            OR c."updatedAt" > t."calculadoAt"
            OR EXISTS (SELECT 1 FROM "propyte_crm"."messages" m
                        WHERE m."contactId" = c."id" AND m."createdAt" > t."calculadoAt")
            OR EXISTS (SELECT 1 FROM "propyte_crm"."activities" a
                        WHERE a."contactId" = c."id" AND a."createdAt" > t."calculadoAt"))
     ORDER BY (t."contactId" IS NULL) DESC, c."updatedAt" DESC
     LIMIT ${limite}`;
  return filas.map((f) => f.id);
}

async function idsViejos(limite: number, excluir: string[]): Promise<string[]> {
  if (limite <= 0) return [];
  const filas = await prisma.contactTemperatura.findMany({
    where: { calculadoAt: { lt: new Date(Date.now() - HORA) }, ...(excluir.length ? { contactId: { notIn: excluir } } : {}) },
    orderBy: { calculadoAt: "asc" },
    take: limite,
    select: { contactId: true },
  });
  return filas.map((f) => f.contactId);
}

interface Senales {
  contactId: string;
  ultimaRespuestaAt: Date | null;
  senalCompraAt: Date | null;
  senalCompra: string | null;
}

/** Última respuesta y última señal de compra de un lote, en una sola consulta. */
async function senalesDe(ids: string[], ahora: Date): Promise<Map<string, Senales>> {
  const desde = new Date(ahora.getTime() - VENTANA_SENAL_MS);
  const patron = patronSenalPostgres();
  const filas = await prisma.$queryRaw<Senales[]>`
    WITH ids AS (SELECT unnest(${ids}::text[]) AS id),
    respuesta AS (
      SELECT ids.id,
        greatest(
          (SELECT max(m."createdAt") FROM "propyte_crm"."messages" m
            WHERE m."contactId" = ids.id AND m."direction" = 'INBOUND' AND coalesce(m."internalNote", false) = false),
          (SELECT max(a."createdAt") FROM "propyte_crm"."activities" a
            WHERE a."contactId" = ids.id AND a."deletedAt" IS NULL AND a."status"::text <> 'CANCELADA'
              AND (a."activityType"::text = ANY(${ACTIVIDADES_DE_RESPUESTA}::text[])
                   OR (a."activityType"::text = 'CALL_OUTBOUND' AND coalesce(a."duration_seconds", 0) >= 30))),
          (SELECT max(cv."lastInboundAt") FROM "propyte_crm"."conversations" cv WHERE cv."contactId" = ids.id)
        ) AS "ultimaRespuestaAt"
      FROM ids
    ),
    senales AS (
      SELECT m."contactId" AS id, m."createdAt" AS at,
             CASE WHEN m."mediaType" = 'document' THEN 'mandó un documento' ELSE 'preguntó por precio, disponibilidad o pagos' END AS que
        FROM "propyte_crm"."messages" m
       WHERE m."contactId" = ANY(${ids}::text[]) AND m."direction" = 'INBOUND' AND m."createdAt" >= ${desde}
         AND coalesce(m."internalNote", false) = false
         AND (m."mediaType" = 'document' OR coalesce(m."body", '') ~* ${patron})
      UNION ALL
      SELECT a."contactId", a."createdAt", 'preguntó por precio, disponibilidad o pagos'
        FROM "propyte_crm"."activities" a
       WHERE a."contactId" = ANY(${ids}::text[]) AND a."deletedAt" IS NULL AND a."createdAt" >= ${desde}
         AND a."activityType"::text = ANY(${ACTIVIDADES_DE_RESPUESTA}::text[])
         AND (coalesce(a."subject", '') || ' ' || coalesce(a."description", '')) ~* ${patron}
      UNION ALL
      SELECT a."contactId", a."createdAt", 'agendó una cita'
        FROM "propyte_crm"."activities" a
       WHERE a."contactId" = ANY(${ids}::text[]) AND a."deletedAt" IS NULL AND a."createdAt" >= ${desde}
         AND a."status"::text <> 'CANCELADA' AND a."activityType"::text = ANY(${ACTIVIDADES_DE_CITA}::text[])
      UNION ALL
      -- changed_at es timestamptz; las demás columnas son timestamp en UTC (Prisma).
      SELECT r."entity_id", (r."changed_at" AT TIME ZONE 'UTC'), 'pasó a ' || initcap(lower(r."new_value" #>> '{}'))
        FROM "propyte_crm"."record_field_changes" r
       WHERE r."entity_type" = 'contact' AND r."field" = 'estado' AND r."entity_id" = ANY(${ids}::text[])
         AND r."changed_at" >= ${desde} AND (r."new_value" #>> '{}') = ANY(${ESTADOS_DE_CITA}::text[])
         -- Un llenado o una migración de datos (#953, #958) o una corrección del administrador no son
         -- una señal del lead (medido el 04-nov: 27 «pasó a Reunión» del llenado del #953).
         AND NOT (coalesce(r."source", '') LIKE ANY (${FUENTES_QUE_NO_SON_SENAL}::text[]))
    ),
    ultima_senal AS (
      SELECT DISTINCT ON (id) id, at, que FROM senales ORDER BY id, at DESC
    )
    SELECT r.id AS "contactId", r."ultimaRespuestaAt", s.at AS "senalCompraAt", s.que AS "senalCompra"
      FROM respuesta r LEFT JOIN ultima_senal s ON s.id = r.id`;
  return new Map(filas.map((f) => [f.contactId, f]));
}

const SELECT_CONTACTO = {
  id: true,
  leadSource: true,
  estado: true,
  razonSalida: true,
  doNotContact: true,
  createdAt: true,
  originalCreatedAt: true,
  temperature: true,
} satisfies Prisma.ContactSelect;

/** Calcula y guarda la temperatura de los contactos dados. Devuelve cuántos guardó y cuántos cambiaron. */
export async function calcularYGuardarTemperaturas(ids: string[], ahora: Date = new Date()): Promise<{ calculados: number; cambiados: number }> {
  if (ids.length === 0) return { calculados: 0, cambiados: 0 };
  const contactos = await prisma.contact.findMany({ where: { id: { in: ids }, deletedAt: null }, select: SELECT_CONTACTO });
  if (contactos.length === 0) return { calculados: 0, cambiados: 0 };
  const senales = await senalesDe(contactos.map((c) => c.id), ahora);

  let cambiados = 0;
  for (const c of contactos) {
    const s = senales.get(c.id);
    const r = calcularTemperatura(
      {
        fuente: c.leadSource ?? null,
        estado: c.estado ?? null,
        razonSalida: c.razonSalida ?? null,
        doNotContact: c.doNotContact,
        entradaAt: c.originalCreatedAt ?? c.createdAt,
        ultimaRespuestaAt: s?.ultimaRespuestaAt ?? null,
        senalCompraAt: s?.senalCompraAt ?? null,
        senalCompra: s?.senalCompra ?? null,
      },
      ahora,
    );
    const fila = {
      temperatura: r.temperatura,
      grupo: r.grupo,
      orden: r.orden,
      motivo: r.motivo,
      ultimaRespuestaAt: s?.ultimaRespuestaAt ?? null,
      senalCompraAt: s?.senalCompraAt ?? null,
      calculadoAt: ahora,
    };
    const cambia = r.temperatura !== (c.temperature ?? null);
    await withChangeSource({ source: FUENTE_CAMBIO_TEMPERATURA }, async (tx) => {
      await tx.contactTemperatura.upsert({ where: { contactId: c.id }, create: { contactId: c.id, ...fila }, update: fila });
      if (cambia) {
        await tx.$executeRaw`UPDATE "propyte_crm"."contacts"
                                SET "temperature" = ${r.temperatura}::"propyte_crm"."LeadTemperature"
                              WHERE "id" = ${c.id}`;
      }
    });
    if (cambia) cambiados++;
  }
  return { calculados: contactos.length, cambiados };
}

/** Tick del cron: hasta `limite` contactos, primero los sucios y luego los viejos. */
export async function recalcularTemperaturas(limite = 200): Promise<{ calculados: number; cambiados: number }> {
  const sucios = await idsSucios(Math.ceil(limite * 0.75));
  const viejos = await idsViejos(limite - sucios.length, sucios);
  return calcularYGuardarTemperaturas([...sucios, ...viejos]);
}

/** Detalle guardado de un contacto, para la ficha. null si no hay o si la tabla aún no existe. */
export async function obtenerTemperaturaContacto(contactId: string) {
  try {
    return await prisma.contactTemperatura.findUnique({ where: { contactId } });
  } catch {
    return null;
  }
}

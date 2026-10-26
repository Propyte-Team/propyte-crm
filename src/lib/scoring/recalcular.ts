// Recálculo del lead score (spec §4). Lo corre el cron de workflows cada minuto, por lotes.
//
// Qué recalcula en cada tick:
//   1. «Sucios»: contactos sin fila en contact_scores, editados después del último cálculo
//      (`updatedAt > calculadoAt`) o calculados con otra versión del modelo.
//   2. «Viejos»: filas con más de 24 h, para que el decaimiento y las actividades/mensajes nuevos
//      (que no tocan contacts.updatedAt) entren al menos una vez al día.
//
// MODO SOMBRA (default): el resultado solo se guarda en contact_scores. Contact.score —el que leen
// CAPI, el ciclo de vida, los workflows y el ruteo— NO se toca hasta que SystemConfig
// `scoring.activo` sea true. Con la bandera encendida se copia a Contact.score con SQL directo
// (no mueve `updatedAt`, así el contacto no vuelve a quedar «sucio») y se emite `contact.scored`
// solo cuando el score cruza un umbral del modelo.
import prisma from "@/lib/db";
import { Prisma } from "@prisma/client";
import { emitEvent } from "@/lib/workflows/events";
import { calcularScore, umbralesCruzados, type ContactoScore, type SenalesScore } from "./calcular";
import { CLAVE_ACTIVO, CLAVE_MODELO, resolverModelo, ventanaMaxDias, type ModeloScore } from "./modelo";

const DIA = 86_400_000;
const VIEJO_MS = DIA;

export async function cargarConfigScoring(): Promise<{ modelo: ModeloScore; activo: boolean; errorModelo?: string }> {
  const filas = await prisma.systemConfig.findMany({ where: { key: { in: [CLAVE_MODELO, CLAVE_ACTIVO] } } });
  const valor = (k: string) => filas.find((f) => f.key === k)?.value;
  const { modelo, error } = resolverModelo(valor(CLAVE_MODELO));
  return { modelo, activo: valor(CLAVE_ACTIVO) === true, ...(error ? { errorModelo: error } : {}) };
}

async function idsSucios(version: number, limite: number): Promise<string[]> {
  if (limite <= 0) return [];
  const filas = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c."id"
      FROM "propyte_crm"."contacts" c
      LEFT JOIN "propyte_crm"."contact_scores" s ON s."contactId" = c."id"
     WHERE c."deletedAt" IS NULL
       AND c."mergedIntoId" IS NULL
       AND (s."contactId" IS NULL OR c."updatedAt" > s."calculadoAt" OR s."modeloVersion" <> ${version})
     ORDER BY c."updatedAt" DESC
     LIMIT ${limite}`;
  return filas.map((f) => f.id);
}

async function idsViejos(limite: number, excluir: string[]): Promise<string[]> {
  if (limite <= 0) return [];
  const filas = await prisma.contactScore.findMany({
    where: { calculadoAt: { lt: new Date(Date.now() - VIEJO_MS) }, ...(excluir.length ? { contactId: { notIn: excluir } } : {}) },
    orderBy: { calculadoAt: "asc" },
    take: limite,
    select: { contactId: true },
  });
  return filas.map((f) => f.contactId);
}

const SELECT_CONTACTO = {
  id: true,
  contactType: true,
  contactStatus: true,
  doNotContact: true,
  leadSource: true,
  purchaseTimeline: true,
  urgency: true,
  paymentMethod: true,
  investmentProfile: true,
  phone: true,
  email: true,
  budgetMin: true,
  budgetMax: true,
  custom: true,
  lastActivityAt: true,
  score: true,
  webBehavior: { select: { daysVisited: true, chatCount: true, visitorScore: true } },
} satisfies Prisma.ContactSelect;

type FilaContacto = Prisma.ContactGetPayload<{ select: typeof SELECT_CONTACTO }>;

function aContactoScore(c: FilaContacto): ContactoScore {
  const custom = (c.custom ?? {}) as Record<string, unknown>;
  return {
    contactType: c.contactType,
    contactStatus: c.contactStatus,
    doNotContact: c.doNotContact,
    leadSource: c.leadSource,
    purchaseTimeline: c.purchaseTimeline,
    urgency: c.urgency,
    paymentMethod: c.paymentMethod,
    investmentProfile: c.investmentProfile,
    phone: c.phone,
    email: c.email,
    budgetMin: c.budgetMin === null ? null : Number(c.budgetMin),
    budgetMax: c.budgetMax === null ? null : Number(c.budgetMax),
    budgetCurrency: typeof custom.budget_currency === "string" ? custom.budget_currency : null,
    lastActivityAt: c.lastActivityAt,
  };
}

/** Junta las señales de un lote de contactos con 4 consultas (no 4 por contacto). */
async function senalesDe(ids: string[], modelo: ModeloScore, ahora: Date): Promise<Map<string, SenalesScore>> {
  const desde = new Date(ahora.getTime() - ventanaMaxDias(modelo) * DIA);
  const [actividades, mensajes, playbooks] = await Promise.all([
    prisma.activity.findMany({
      where: { contactId: { in: ids }, createdAt: { gte: desde }, deletedAt: null, status: { not: "CANCELADA" } },
      select: { contactId: true, activityType: true, createdAt: true },
    }),
    prisma.message.findMany({
      where: { contactId: { in: ids }, direction: "INBOUND", createdAt: { gte: desde } },
      select: { contactId: true, createdAt: true },
    }),
    prisma.conversationPlaybookState.findMany({
      where: { status: "COMPLETED", conversation: { contactId: { in: ids } } },
      select: { conversation: { select: { contactId: true } } },
    }),
  ]);

  const mapa = new Map<string, SenalesScore>();
  const de = (id: string) => {
    let s = mapa.get(id);
    if (!s) mapa.set(id, (s = { actividades: [], entrantes: [], playbookCompletado: false }));
    return s;
  };
  for (const id of ids) de(id);
  for (const a of actividades) if (a.contactId) de(a.contactId).actividades.push({ tipo: a.activityType, fecha: a.createdAt });
  for (const m of mensajes) de(m.contactId).entrantes.push(m.createdAt);
  for (const p of playbooks) if (p.conversation) de(p.conversation.contactId).playbookCompletado = true;
  return mapa;
}

/** Calcula y guarda el score de los contactos dados. Devuelve cuántos guardó. */
export async function calcularYGuardar(
  ids: string[],
  cfg: { modelo: ModeloScore; activo: boolean },
  ahora: Date = new Date()
): Promise<number> {
  if (ids.length === 0) return 0;
  const contactos = await prisma.contact.findMany({ where: { id: { in: ids }, deletedAt: null }, select: SELECT_CONTACTO });
  const senales = await senalesDe(contactos.map((c) => c.id), cfg.modelo, ahora);

  let guardados = 0;
  for (const c of contactos) {
    const s = senales.get(c.id) ?? { actividades: [], entrantes: [], playbookCompletado: false };
    const r = calcularScore(aContactoScore(c), { ...s, web: c.webBehavior }, cfg.modelo, ahora);
    const datos = {
      score: r.score,
      desglose: r.desglose as unknown as Prisma.InputJsonValue,
      motivo: r.motivo ?? null,
      modeloVersion: r.version,
      calculadoAt: ahora,
    };
    await prisma.contactScore.upsert({ where: { contactId: c.id }, create: { contactId: c.id, ...datos }, update: datos });
    guardados++;

    // Solo con la bandera encendida, y nunca para excluidos (score null): su Contact.score se queda.
    if (cfg.activo && r.score !== null && r.score !== c.score) {
      await prisma.$executeRaw`UPDATE "propyte_crm"."contacts" SET "score" = ${r.score} WHERE "id" = ${c.id}`;
      const cruzados = umbralesCruzados(c.score, r.score, cfg.modelo.umbrales);
      if (cruzados.length > 0) {
        await emitEvent("contact.scored", "contact", c.id, { score: r.score, anterior: c.score, umbrales: cruzados });
      }
    }
  }
  return guardados;
}

/** Tick del cron: hasta `limite` contactos, primero los sucios y luego los viejos. */
export async function recalcularScores(limite = 200): Promise<{ calculados: number; activo: boolean; errorModelo?: string }> {
  const cfg = await cargarConfigScoring();
  if (cfg.errorModelo) console.warn(`[scoring] scoring.modelo inválido, se usa el default: ${cfg.errorModelo}`);
  const sucios = await idsSucios(cfg.modelo.version, Math.ceil(limite * 0.75));
  const viejos = await idsViejos(limite - sucios.length, sucios);
  const calculados = await calcularYGuardar([...sucios, ...viejos], cfg);
  return { calculados, activo: cfg.activo, ...(cfg.errorModelo ? { errorModelo: cfg.errorModelo } : {}) };
}

/** Score guardado de un contacto, para la ficha. null si no hay o si la tabla aún no existe. */
export async function obtenerScoreContacto(contactId: string) {
  try {
    return await prisma.contactScore.findUnique({ where: { contactId } });
  } catch {
    return null;
  }
}

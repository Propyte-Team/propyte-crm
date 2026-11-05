// #988 — La cadencia de nuevos contra la base: el tick del cron, el resultado que marca el asesor,
// «Mi día», la ficha y el tablero de vencidas.
//
// Quién hace qué:
//   - INSCRIBIR y TERMINAR al salir del estado: el disparador trg_contacts_zz_copilot_cadencia
//     (migración 2026-11-05-copilot-mi-dia.sql). Así cubre todas las vías que escriben contactos.
//   - El resto, el cron de workflows cada minuto (etapa «cadencias», tickCadencias):
//       1. crea los toques del día (y los de días atrasados si el cron estuvo parado);
//       2. detecta respuestas del lead → Contactado · En conversación y la cadencia se detiene;
//          y el primer intento del asesor → Nuevo pasa a Sin respuesta;
//       3. al pasar el último día sin respuesta → Perdido · Sin respuesta tras cadencia
//          (flujograma: «al terminar la cadencia de nuevos sin ninguna respuesta»);
//       4. a las 24 h sin marcar, avisa al gerente (una vez por toque).
//
// Los cambios de estado llevan la fuente copilot_cadencia en la cronología.
import prisma from "@/lib/db";
import { Prisma } from "@prisma/client";
import { setChangeSource, type PrismaTx } from "@/lib/audit/change-context";
import { normalizePhoneE164 } from "@/lib/phone";
import { mandoWhere, esCuentaTecnica } from "@/lib/workflows/ruteables";
import {
  ULTIMO_DIA,
  TOPE_TAREAS_DIA,
  VENCIDA_MS,
  calendarioCompleto,
  diaDeCadencia,
  esIntento,
  esResultadoDelCanal,
  esRespuesta,
  fechaCancun,
  fechaDelDia,
  modoSmsDelDia4,
  paisDeTelefono,
  toquesDelDia,
  type ModoSms,
  type PerfilCadencia,
  type TipoCadencia,
} from "./cadencia-nuevos";
import { armarTareas, fechaDe, ordenarMiDia, type MiDia, type TareaLista } from "./mi-dia";
import type { Plantilla } from "./plantillas";

export const FUENTE_CAMBIO_CADENCIA = "copilot_cadencia";
const ESTADOS_DE_LA_CADENCIA = ["NUEVO", "SIN_RESPUESTA"];

function tipoDe(t: string): TipoCadencia {
  return t === "BASE_DE_DATOS" ? "BASE_DE_DATOS" : "NUEVOS";
}

/** Inicio (UTC) del día civil de Cancún AAAA-MM-DD: 00:00 en Cancún = 05:00 UTC. */
function inicioDelDiaCancun(fecha: string): Date {
  return new Date(Date.parse(`${fecha}T05:00:00Z`));
}

// ───────────────────────────── 1. crear los toques del día ─────────────────────────────

/** ¿El lead ya escribió por WhatsApp? (EE. UU.: sin eso Meta no deja escribirle). */
async function conWhatsAppAbierto(contactIds: string[]): Promise<Set<string>> {
  if (contactIds.length === 0) return new Set();
  const filas = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT m."contactId" AS id FROM "propyte_crm"."messages" m
     WHERE m."contactId" = ANY(${contactIds}::text[]) AND m."direction" = 'INBOUND' AND m."channel"::text = 'WHATSAPP'`;
  return new Set(filas.map((f) => f.id));
}

/**
 * Crea los toques de los días que ya llegaron y aún no tienen. Idempotente (único por cadencia y
 * código). Con `contactIds` solo esos (lo usa «Mi día» al abrir, para no esperar al cron).
 */
export async function materializarCadencias(
  opts: { ahora?: Date; limite?: number; contactIds?: string[] } = {},
): Promise<{ cadencias: number; toques: number }> {
  const ahora = opts.ahora ?? new Date();
  const activas = await prisma.copilotCadencia.findMany({
    where: { estado: "ACTIVA", ...(opts.contactIds ? { contactId: { in: opts.contactIds } } : {}) },
    orderBy: { inicio: "asc" },
    take: opts.contactIds ? undefined : opts.limite ?? 300,
  });
  const pendientes = activas.filter((k) => {
    const dia = Math.min(diaDeCadencia(fechaDe(k.diaInicio), ahora), ULTIMO_DIA[tipoDe(k.tipo)]);
    return k.diaMaterializado < dia;
  });
  if (pendientes.length === 0) return { cadencias: 0, toques: 0 };

  const contactos = await prisma.contact.findMany({
    where: { id: { in: pendientes.map((k) => k.contactId) } },
    select: { id: true, phone: true, leadSource: true },
  });
  const porId = new Map(contactos.map((c) => [c.id, c]));
  const waAbierto = await conWhatsAppAbierto(contactos.map((c) => c.id));

  let toques = 0;
  for (const k of pendientes) {
    const c = porId.get(k.contactId);
    if (!c) continue;
    const tipo = tipoDe(k.tipo);
    const diaInicio = fechaDe(k.diaInicio);
    const hasta = Math.min(diaDeCadencia(diaInicio, ahora), ULTIMO_DIA[tipo]);
    const pais = paisDeTelefono(normalizePhoneE164(c.phone));
    let modoSms = (k.modoSms as ModoSms | null) ?? null;
    if (!modoSms && hasta >= 4) modoSms = modoSmsDelDia4(pais, waAbierto.has(c.id));

    const perfil: PerfilCadencia = {
      tipo,
      pais,
      fuente: c.leadSource ?? null,
      waAbierto: waAbierto.has(c.id),
      modoSms,
      horaEntrada: k.horaEntrada,
    };
    const filas: Prisma.CopilotToqueCreateManyInput[] = [];
    for (let d = k.diaMaterializado + 1; d <= hasta; d++) {
      const fecha = fechaDelDia(diaInicio, d);
      // Aparece en «Mi día» al empezar su día (el día 1, al entrar): de ahí se cuentan las 24 h.
      const aparece = d === 1 ? new Date(k.inicio) : inicioDelDiaCancun(fecha);
      // Antes del día 4 el SMS va en complementario aunque ya se sepa el modo.
      const p = d < 4 ? { ...perfil, modoSms: null } : perfil;
      for (const t of toquesDelDia(d, p)) {
        filas.push({
          cadenciaId: k.id,
          contactId: k.contactId,
          dia: d,
          fecha: new Date(`${fecha}T00:00:00Z`),
          codigo: t.codigo,
          canal: t.canal,
          orden: t.orden,
          plantilla: t.plantilla,
          cuando: t.cuando,
          createdAt: aparece,
        });
      }
    }
    await prisma.$transaction([
      prisma.copilotToque.createMany({ data: filas, skipDuplicates: true }),
      prisma.copilotCadencia.update({
        where: { id: k.id },
        data: { diaMaterializado: hasta, ...(modoSms !== k.modoSms ? { modoSms } : {}) },
      }),
    ]);
    toques += filas.length;
  }
  return { cadencias: pendientes.length, toques };
}

// ───────────────────────────── 2. respuestas e intentos ─────────────────────────────

/** Termina la cadencia por respuesta y pasa el contacto a Contactado · En conversación. */
async function terminarPorRespuesta(
  tx: PrismaTx,
  k: { id: string; contactId: string },
  respuestaAt: Date,
): Promise<void> {
  // Primero la cadencia: así el disparador del contacto ya no encuentra una activa.
  await tx.copilotToque.deleteMany({ where: { cadenciaId: k.id, resultado: null } });
  await tx.copilotCadencia.update({
    where: { id: k.id },
    data: { estado: "TERMINADA", motivoFin: "RESPONDIO", respuestaAt, finAt: new Date() },
  });
  await tx.contact.updateMany({
    where: { id: k.contactId, estado: { in: ESTADOS_DE_LA_CADENCIA as never } },
    data: { estado: "CONTACTADO" as never, subestado: "EN_CONVERSACION" },
  });
}

/** Nuevo → Sin respuesta en cuanto hay un primer intento (flujograma). */
async function pasarASinRespuesta(tx: PrismaTx, contactId: string): Promise<void> {
  await tx.contact.updateMany({
    where: { id: contactId, estado: "NUEVO" as never },
    data: { estado: "SIN_RESPUESTA" as never, subestado: null },
  });
}

interface FilaSenal {
  id: string;
  contactId: string;
  primerIntentoAt: Date | null;
  respuestaAt: Date | null;
  estado: string | null;
}

/**
 * Primer intento y primera respuesta de cada cadencia activa, en una consulta.
 *
 * Intento: un toque marcado (primerIntentoAt), o un mensaje, llamada, WhatsApp, SMS o correo que
 * el asesor mandó desde el CRM después de que entró.
 *
 * Respuesta (la misma lista que la temperatura, #973): un mensaje o actividad entrante DESPUÉS del
 * primer intento —antes de eso, lo que escribió es con lo que llegó, o la plática con el bot—, o en
 * cualquier momento desde que entró una llamada entrante, un walk-in o una llamada nuestra de 30 s
 * o más (contestó una persona).
 */
async function senalesDeCadencias(): Promise<FilaSenal[]> {
  return prisma.$queryRaw<FilaSenal[]>`
    WITH k AS (
      SELECT k."id", k."contactId", k."inicio",
        LEAST(
          k."primerIntentoAt",
          (SELECT min(m."createdAt") FROM "propyte_crm"."messages" m
            WHERE m."contactId" = k."contactId" AND m."direction" = 'OUTBOUND' AND m."sender"::text = 'ADVISOR'
              AND m."createdAt" > k."inicio"),
          (SELECT min(a."createdAt") FROM "propyte_crm"."activities" a
            WHERE a."contactId" = k."contactId" AND a."deletedAt" IS NULL AND a."createdAt" > k."inicio"
              AND a."activityType"::text = ANY(ARRAY['CALL_OUTBOUND','WHATSAPP_OUT','SMS_OUT','EMAIL_SENT','INSTAGRAM_OUT','MESSENGER_OUT']::text[]))
        ) AS "primerIntentoAt"
      FROM "propyte_crm"."copilot_cadencias" k
      WHERE k."estado" = 'ACTIVA'
    )
    SELECT k."id", k."contactId", k."primerIntentoAt", c."estado"::text AS "estado",
      LEAST(
        (SELECT min(m."createdAt") FROM "propyte_crm"."messages" m
          WHERE m."contactId" = k."contactId" AND m."direction" = 'INBOUND' AND coalesce(m."internalNote", false) = false
            AND k."primerIntentoAt" IS NOT NULL AND m."createdAt" > k."primerIntentoAt"),
        (SELECT min(a."createdAt") FROM "propyte_crm"."activities" a
          WHERE a."contactId" = k."contactId" AND a."deletedAt" IS NULL AND a."status"::text <> 'CANCELADA'
            AND (
              (a."activityType"::text = ANY(ARRAY['CALL_INBOUND','WALK_IN']::text[]) AND a."createdAt" > k."inicio")
              OR (a."activityType"::text = 'CALL_OUTBOUND' AND coalesce(a."duration_seconds", 0) >= 30 AND a."createdAt" > k."inicio")
              OR (a."activityType"::text = ANY(ARRAY['WHATSAPP_IN','SMS_IN','EMAIL_RECEIVED','INSTAGRAM_IN','MESSENGER_IN']::text[])
                  AND k."primerIntentoAt" IS NOT NULL AND a."createdAt" > k."primerIntentoAt")))
      ) AS "respuestaAt"
    FROM k JOIN "propyte_crm"."contacts" c ON c."id" = k."contactId"`;
}

export async function detectarRespuestas(): Promise<{ respondieron: number; aSinRespuesta: number }> {
  const filas = await senalesDeCadencias();
  let respondieron = 0;
  let aSinRespuesta = 0;
  for (const f of filas) {
    if (f.respuestaAt) {
      await prisma.$transaction(async (tx) => {
        await setChangeSource(tx, { source: FUENTE_CAMBIO_CADENCIA });
        await terminarPorRespuesta(tx, f, f.respuestaAt!);
      });
      respondieron++;
      continue;
    }
    if (f.primerIntentoAt) {
      await prisma.$transaction(async (tx) => {
        await setChangeSource(tx, { source: FUENTE_CAMBIO_CADENCIA });
        await tx.copilotCadencia.updateMany({ where: { id: f.id, primerIntentoAt: null }, data: { primerIntentoAt: f.primerIntentoAt } });
        if (f.estado === "NUEVO") {
          await pasarASinRespuesta(tx, f.contactId);
          aSinRespuesta++;
        }
      });
    }
  }
  return { respondieron, aSinRespuesta };
}

// ───────────────────────────── 3. fin de la cadencia ─────────────────────────────

/** Pasó el último día sin respuesta → Perdido · Sin respuesta tras cadencia. */
export async function terminarCadenciasVencidas(ahora: Date = new Date()): Promise<{ terminadas: number; aPerdido: number }> {
  const activas = await prisma.copilotCadencia.findMany({ where: { estado: "ACTIVA" } });
  const acabadas = activas.filter((k) => diaDeCadencia(fechaDe(k.diaInicio), ahora) > ULTIMO_DIA[tipoDe(k.tipo)]);
  let aPerdido = 0;
  for (const k of acabadas) {
    const movidos = await prisma.$transaction(async (tx) => {
      await setChangeSource(tx, { source: FUENTE_CAMBIO_CADENCIA });
      await tx.copilotToque.updateMany({ where: { cadenciaId: k.id, resultado: null }, data: { resultado: "NO_HECHO", resultadoAt: ahora } });
      await tx.copilotCadencia.update({ where: { id: k.id }, data: { estado: "TERMINADA", motivoFin: "SIN_RESPUESTA", finAt: ahora } });
      const r = await tx.contact.updateMany({
        where: { id: k.contactId, estado: { in: ESTADOS_DE_LA_CADENCIA as never } },
        data: { estado: "PERDIDO" as never, subestado: null, razonSalida: "SIN_RESPUESTA_TRAS_CADENCIA" as never },
      });
      return r.count;
    });
    aPerdido += movidos;
  }
  return { terminadas: acabadas.length, aPerdido };
}

// ───────────────────────────── 4. aviso de vencidas al gerente ─────────────────────────────

/** A quién se le avisa de las vencidas de un asesor: su líder, o la gerencia de su plaza. */
async function mandosDe(asesor: { id: string; teamLeaderId: string | null; plaza: string | null }): Promise<string[]> {
  if (asesor.teamLeaderId && asesor.teamLeaderId !== asesor.id) return [asesor.teamLeaderId];
  const base = { ...mandoWhere(), id: { not: asesor.id } };
  for (const where of [
    { ...base, role: "GERENTE" as never, ...(asesor.plaza ? { plaza: asesor.plaza as never } : {}) },
    { ...base, role: "DIRECTOR" as never, ...(asesor.plaza ? { plaza: asesor.plaza as never } : {}) },
    { ...base, role: "GERENTE" as never },
    base,
  ]) {
    const us = await prisma.user.findMany({ where, select: { id: true } });
    if (us.length > 0) return us.map((u) => u.id);
  }
  return [];
}

export async function avisarVencidas(ahora: Date = new Date()): Promise<{ avisos: number; toques: number }> {
  const limite = new Date(ahora.getTime() - VENCIDA_MS);
  const vencidos = await prisma.$queryRaw<{ id: string; cadenciaId: string; fecha: Date; asesorId: string | null }[]>`
    SELECT t."id", t."cadenciaId", t."fecha", c."assignedToId" AS "asesorId"
      FROM "propyte_crm"."copilot_toques" t
      JOIN "propyte_crm"."copilot_cadencias" k ON k."id" = t."cadenciaId" AND k."estado" = 'ACTIVA'
      JOIN "propyte_crm"."contacts" c ON c."id" = t."contactId"
     WHERE t."resultado" IS NULL AND t."avisoVencidaAt" IS NULL AND t."createdAt" <= ${limite}
     LIMIT 1000`;
  if (vencidos.length === 0) return { avisos: 0, toques: 0 };

  const porAsesor = new Map<string, { tareas: Set<string> }>();
  for (const v of vencidos) {
    if (!v.asesorId) continue;
    const g = porAsesor.get(v.asesorId) ?? { tareas: new Set<string>() };
    g.tareas.add(`${v.cadenciaId}:${fechaDe(v.fecha)}`);
    porAsesor.set(v.asesorId, g);
  }
  const asesores = await prisma.user.findMany({
    where: { id: { in: [...porAsesor.keys()] } },
    select: { id: true, name: true, email: true, teamLeaderId: true, plaza: true },
  });

  let avisos = 0;
  for (const a of asesores) {
    // Cuentas técnicas (.local): nadie las abre; avisar solo llenaría la campana (#734, #756).
    if (esCuentaTecnica(a.email)) continue;
    const n = porAsesor.get(a.id)?.tareas.size ?? 0;
    if (n === 0) continue;
    const destinatarios = await mandosDe({ id: a.id, teamLeaderId: a.teamLeaderId, plaza: a.plaza as string | null });
    if (destinatarios.length === 0) continue;
    await prisma.notification.createMany({
      data: destinatarios.map((userId) => ({
        userId,
        type: "copilot_vencida",
        title: "Mi día: tareas vencidas",
        message: `${a.name} tiene ${n} ${n === 1 ? "tarea" : "tareas"} de la cadencia de nuevos sin marcar desde hace más de 24 h.`,
        link: "/copilot/vencidas",
      })),
    });
    avisos += destinatarios.length;
  }
  // Se marcan todos, también los de cuentas técnicas o sin asesor: un aviso por toque, nunca dos.
  await prisma.copilotToque.updateMany({ where: { id: { in: vencidos.map((v) => v.id) } }, data: { avisoVencidaAt: ahora } });
  return { avisos, toques: vencidos.length };
}

// ───────────────────────────── tick ─────────────────────────────

/** Etapa «cadencias» del cron. El orden importa: una respuesta gana al fin de la cadencia. */
export async function tickCadencias(ahora: Date = new Date()) {
  const materializadas = await materializarCadencias({ ahora });
  const respuestas = await detectarRespuestas();
  const fin = await terminarCadenciasVencidas(ahora);
  const vencidas = await avisarVencidas(ahora);
  return { ...materializadas, ...respuestas, ...fin, ...vencidas };
}

// ───────────────────────────── resultado del asesor ─────────────────────────────

export type ResultadoMarcar =
  | { ok: true; terminada: boolean }
  | { ok: false; status: number; error: string };

/**
 * Marca (o desmarca, con `resultado: null`) un toque. Contestó o Respondió terminan la cadencia y
 * pasan al contacto a Contactado; un intento pasa Nuevo → Sin respuesta.
 */
export async function marcarResultado(opts: {
  toqueId: string;
  resultado: string | null;
  variante?: string | null;
  usuarioId: string;
  ahora?: Date;
}): Promise<ResultadoMarcar> {
  const ahora = opts.ahora ?? new Date();
  const t = await prisma.copilotToque.findUnique({ where: { id: opts.toqueId } });
  if (!t) return { ok: false, status: 404, error: "El toque ya no existe (la cadencia pudo haber terminado)" };
  const k = await prisma.copilotCadencia.findUnique({ where: { id: t.cadenciaId } });
  if (!k || k.estado !== "ACTIVA") return { ok: false, status: 409, error: "La cadencia de este contacto ya terminó" };
  if (opts.resultado !== null && !esResultadoDelCanal(t.canal, opts.resultado)) {
    return { ok: false, status: 400, error: "Ese resultado no aplica a este toque" };
  }
  if (t.dia > diaDeCadencia(fechaDe(k.diaInicio), ahora)) {
    return { ok: false, status: 409, error: "Este toque todavía no toca" };
  }

  return prisma.$transaction(async (tx) => {
    await setChangeSource(tx, { source: FUENTE_CAMBIO_CADENCIA, actorId: opts.usuarioId });
    await tx.copilotToque.update({
      where: { id: t.id },
      data: {
        resultado: opts.resultado,
        resultadoAt: opts.resultado ? ahora : null,
        resultadoPorId: opts.resultado ? opts.usuarioId : null,
        ...(opts.variante !== undefined ? { variante: opts.variante } : {}),
      },
    });
    if (esRespuesta(opts.resultado)) {
      await terminarPorRespuesta(tx, k, ahora);
      return { ok: true as const, terminada: true };
    }
    if (esIntento(opts.resultado)) {
      if (!k.primerIntentoAt) await tx.copilotCadencia.update({ where: { id: k.id }, data: { primerIntentoAt: ahora } });
      await pasarASinRespuesta(tx, k.contactId);
    }
    return { ok: true as const, terminada: false };
  });
}

// ───────────────────────────── lectura ─────────────────────────────

const SELECT_CONTACTO = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  preferredLanguage: true,
  preferredZone: true,
  targetPlaza: true,
  estado: true,
  doNotContact: true,
  assignedToId: true,
} satisfies Prisma.ContactSelect;

async function cargarPlantillas(): Promise<Plantilla[]> {
  const filas = await prisma.copilotPlantilla.findMany({ orderBy: [{ orden: "asc" }, { idioma: "asc" }] });
  return filas.map((p) => ({ ...p, idioma: p.idioma === "EN" ? "EN" : "ES" }));
}

async function armarDesde(cadencias: Awaited<ReturnType<typeof prisma.copilotCadencia.findMany>>, toques: Awaited<ReturnType<typeof prisma.copilotToque.findMany>>, ahora: Date) {
  const contactIds = [...new Set(cadencias.map((k) => k.contactId))];
  const [contactos, temperaturas, plantillas] = await Promise.all([
    prisma.contact.findMany({ where: { id: { in: contactIds } }, select: SELECT_CONTACTO }),
    prisma.contactTemperatura.findMany({ where: { contactId: { in: contactIds } } }).catch(() => []),
    cargarPlantillas(),
  ]);
  const asesorIds = [...new Set(contactos.map((c) => c.assignedToId).filter((x): x is string => !!x))];
  const asesores = await prisma.user.findMany({ where: { id: { in: asesorIds } }, select: { id: true, name: true, role: true, phone: true } });
  const tareas = armarTareas({
    cadencias,
    toques,
    contactos: contactos.map((c) => ({ ...c, estado: (c.estado as string | null) ?? null, preferredLanguage: c.preferredLanguage as string, targetPlaza: (c.targetPlaza as string | null) ?? null })),
    asesores: asesores.map((a) => ({ ...a, role: a.role as string })),
    temperaturas: temperaturas.map((t) => ({ contactId: t.contactId, temperatura: (t.temperatura as string | null) ?? null, orden: t.orden, motivo: t.motivo })),
    plantillas,
    ahora,
  });
  return { tareas, temperaturas };
}

/** «Mi día» del asesor: sus tareas de hoy y las atrasadas, en orden y con el tope de 40. */
export async function miDia(usuarioId: string, ahora: Date = new Date()): Promise<MiDia & { hoy: string }> {
  const hoy = fechaCancun(ahora);
  const suyos = await prisma.copilotCadencia.findMany({
    where: { estado: "ACTIVA" },
    select: { contactId: true },
  });
  const deEl = await prisma.contact.findMany({
    where: { id: { in: suyos.map((s) => s.contactId) }, assignedToId: usuarioId, deletedAt: null },
    select: { id: true },
  });
  const ids = deEl.map((c) => c.id);
  if (ids.length === 0) return { hoy, tareas: [], fueraDelTope: 0, hechasHoy: [], vencidas: 0 };

  // Que el L1 de un lead que acaba de entrar no espere al cron.
  await materializarCadencias({ ahora, contactIds: ids });

  const cadencias = await prisma.copilotCadencia.findMany({ where: { estado: "ACTIVA", contactId: { in: ids } } });
  const toques = await prisma.copilotToque.findMany({
    where: { cadenciaId: { in: cadencias.map((k) => k.id) }, fecha: { lte: new Date(`${hoy}T00:00:00Z`) } },
  });
  // Solo los días con algo pendiente, y el de hoy (para «hechas hoy»).
  const diasConPendiente = new Set(toques.filter((t) => !t.resultado).map((t) => `${t.cadenciaId}:${fechaDe(t.fecha)}`));
  const visibles = toques.filter((t) => diasConPendiente.has(`${t.cadenciaId}:${fechaDe(t.fecha)}`) || fechaDe(t.fecha) === hoy);

  const { tareas, temperaturas } = await armarDesde(cadencias, visibles, ahora);
  const orden = new Map(temperaturas.map((t) => [t.contactId, t.orden]));
  const inicio = new Map(cadencias.map((k) => [k.id, k.inicio]));
  return {
    hoy,
    ...ordenarMiDia(tareas, hoy, TOPE_TAREAS_DIA, (id) => orden.get(id) ?? null, (id) => inicio.get(id) ?? new Date(0)),
  };
}

export interface CadenciaDeContacto {
  id: string;
  tipo: TipoCadencia;
  estado: string;
  motivoFin: string | null;
  dia: number;
  ultimoDia: number;
  diaInicio: string;
  finAt: string | null;
  /** Días con toques ya creados (hoy y atrás), con su texto. */
  tareas: TareaLista[];
  /** Lo que falta: día, código y canal de los toques de los días que vienen. */
  siguientes: { dia: number; fecha: string; codigo: string; canal: string }[];
}

/** La cadencia del contacto para su ficha: la activa, o la última que tuvo. null si nunca tuvo. */
export async function cadenciaDeContacto(contactId: string, ahora: Date = new Date()): Promise<CadenciaDeContacto | null> {
  await materializarCadencias({ ahora, contactIds: [contactId] }).catch(() => undefined);
  const k =
    (await prisma.copilotCadencia.findFirst({ where: { contactId, estado: "ACTIVA" } })) ??
    (await prisma.copilotCadencia.findFirst({ where: { contactId }, orderBy: { inicio: "desc" } }));
  if (!k) return null;
  const toques = await prisma.copilotToque.findMany({ where: { cadenciaId: k.id }, orderBy: [{ dia: "asc" }, { orden: "asc" }] });
  const { tareas } = await armarDesde([k], toques, ahora);
  tareas.sort((a, b) => b.dia - a.dia);

  const tipo = tipoDe(k.tipo);
  const diaInicio = fechaDe(k.diaInicio);
  const dia = diaDeCadencia(diaInicio, ahora);
  let siguientes: CadenciaDeContacto["siguientes"] = [];
  if (k.estado === "ACTIVA") {
    const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { phone: true, leadSource: true } });
    const pais = paisDeTelefono(normalizePhoneE164(c?.phone));
    const plan = calendarioCompleto({
      tipo,
      pais,
      fuente: c?.leadSource ?? null,
      waAbierto: (await conWhatsAppAbierto([contactId])).has(contactId),
      modoSms: (k.modoSms as ModoSms | null) ?? modoSmsDelDia4(pais, false),
      horaEntrada: k.horaEntrada,
    });
    siguientes = plan
      .filter((t) => t.dia > Math.max(dia, k.diaMaterializado))
      .map((t) => ({ dia: t.dia, fecha: fechaDelDia(diaInicio, t.dia), codigo: t.codigo, canal: t.canal }));
  }
  return {
    id: k.id,
    tipo,
    estado: k.estado,
    motivoFin: k.motivoFin,
    dia: Math.min(dia, ULTIMO_DIA[tipo] + 1),
    ultimoDia: ULTIMO_DIA[tipo],
    diaInicio,
    finAt: k.finAt ? k.finAt.toISOString() : null,
    tareas,
    siguientes,
  };
}

export interface FilaTablero {
  asesorId: string;
  asesor: string;
  tareasVencidas: number;
  contactos: { id: string; nombre: string; dia: number; desde: string }[];
}

/** Tablero de vencidas por asesor (24 h o más sin marcar). `owners` undefined = todos. */
export async function tableroVencidas(owners: string[] | undefined, ahora: Date = new Date()): Promise<FilaTablero[]> {
  const limite = new Date(ahora.getTime() - VENCIDA_MS);
  const filas = await prisma.$queryRaw<{ asesorId: string; asesor: string; contactId: string; nombre: string; dia: number; fecha: Date; desde: Date }[]>`
    SELECT c."assignedToId" AS "asesorId", u."name" AS "asesor", c."id" AS "contactId",
           trim(coalesce(c."firstName", '') || ' ' || coalesce(c."lastName", '')) AS "nombre",
           t."dia", t."fecha", min(t."createdAt") AS "desde"
      FROM "propyte_crm"."copilot_toques" t
      JOIN "propyte_crm"."copilot_cadencias" k ON k."id" = t."cadenciaId" AND k."estado" = 'ACTIVA'
      JOIN "propyte_crm"."contacts" c ON c."id" = t."contactId" AND c."deletedAt" IS NULL
      JOIN "propyte_crm"."users" u ON u."id" = c."assignedToId"
     WHERE t."resultado" IS NULL AND t."createdAt" <= ${limite}
       AND (${owners ?? null}::text[] IS NULL OR c."assignedToId" = ANY(${owners ?? null}::text[]))
     GROUP BY 1, 2, 3, 4, 5, 6
     ORDER BY 2, 7`;
  const porAsesor = new Map<string, FilaTablero>();
  for (const f of filas) {
    const g = porAsesor.get(f.asesorId) ?? { asesorId: f.asesorId, asesor: f.asesor, tareasVencidas: 0, contactos: [] };
    g.tareasVencidas++;
    g.contactos.push({ id: f.contactId, nombre: f.nombre || "Sin nombre", dia: f.dia, desde: new Date(f.desde).toISOString() });
    porAsesor.set(f.asesorId, g);
  }
  return [...porAsesor.values()].sort((a, b) => b.tareasVencidas - a.tareasVencidas);
}

export { esTablaSinMigrar } from "./sin-migrar";

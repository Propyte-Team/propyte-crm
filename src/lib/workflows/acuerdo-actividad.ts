/**
 * Acuerdo de actividad: los mínimos por asesor (SystemConfig `activity_agreement`) como
 * alerta real. Hasta E8 nadie leía esos números; ahora, cada mañana, el líder de equipo
 * (o la gerencia de la plaza si el asesor no tiene líder) recibe un aviso por cada asesor
 * que no llegó a los mínimos del día laboral anterior (y, los lunes, de la semana pasada).
 *
 * La parte de decisión (`evaluarAcuerdo`) es pura. `revisarAcuerdoDeActividad` es la que
 * toca la base y se llama desde el cron de workflows.
 *
 * No evalúa `maxFirstResponseMinutes` ni `maxInactivityDays`: la primera respuesta ya la
 * vigila el SLA (sla.ts) y la inactividad las reglas INACTIVITY del scheduler.
 */
import type prismaClient from "@/lib/db";
import { ACTIVITY_AGREEMENT_DEFAULTS } from "@/lib/constants";
import { asesorRuteableWhere, esCuentaTecnica } from "./ruteables";
import { gerenciaDeLaPlaza } from "./gerencia";

type Db = typeof prismaClient;

export const CLAVE_ACUERDO = "activity_agreement";
export const CLAVE_ULTIMA_CORRIDA = "activity_agreement.last_run";
export const TIPO_NOTIFICACION = "activity_below_minimum";

/** Qué tipos de actividad cuentan para cada mínimo. */
export const TIPOS_LLAMADA = ["CALL_OUTBOUND", "DISCOVERY_CALL"] as const;
export const TIPOS_WHATSAPP = ["WHATSAPP_OUT"] as const;
export const TIPOS_VISITA = ["MEETING_PRESENTIAL", "MEETING_SHOWROOM", "WALK_IN"] as const;
export const TIPOS_SEGUIMIENTO = ["FOLLOW_UP"] as const;

/** Cancún (y toda la operación) es UTC-5 fijo, sin horario de verano. */
const OFFSET_HORAS = -5;
/** No se revisa antes de esta hora local: el aviso es "de la mañana". */
const HORA_MINIMA_LOCAL = 8;

export type Metrica = "llamadas" | "whatsapps" | "seguimientos" | "visitas";

export interface Minimos {
  minDailyCalls: number;
  minDailyWhatsapps: number;
  minWeeklyVisits: number;
  minDailyFollowUps: number;
}

export interface ConteoAsesor {
  userId: string;
  nombre: string;
  llamadas: number;
  whatsapps: number;
  seguimientos: number;
  /** null = la semana no se evalúa en esta corrida (solo se evalúa los lunes). */
  visitas: number | null;
}

export interface Faltante {
  metrica: Metrica;
  periodo: "dia" | "semana";
  logrado: number;
  minimo: number;
}

export interface Incumplimiento {
  userId: string;
  nombre: string;
  faltantes: Faltante[];
}

const ETIQUETA: Record<Metrica, string> = {
  llamadas: "llamadas",
  whatsapps: "WhatsApps",
  seguimientos: "seguimientos",
  visitas: "visitas",
};

/** Mínimos efectivos: lo guardado sobre los defaults. Un valor <= 0 desactiva ese mínimo. */
export function resolverMinimos(guardado: unknown): Minimos {
  const g = guardado && typeof guardado === "object" ? (guardado as Record<string, unknown>) : {};
  const num = (k: keyof Minimos): number => {
    const v = g[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    return ACTIVITY_AGREEMENT_DEFAULTS[k];
  };
  return {
    minDailyCalls: num("minDailyCalls"),
    minDailyWhatsapps: num("minDailyWhatsapps"),
    minWeeklyVisits: num("minWeeklyVisits"),
    minDailyFollowUps: num("minDailyFollowUps"),
  };
}

/** Puro: quién no llegó a qué mínimo. Un mínimo <= 0 no se evalúa. */
export function evaluarAcuerdo(args: { minimos: Minimos; conteos: ConteoAsesor[] }): Incumplimiento[] {
  const { minimos, conteos } = args;
  const out: Incumplimiento[] = [];
  for (const c of conteos) {
    const faltantes: Faltante[] = [];
    const chequear = (
      metrica: Metrica,
      periodo: "dia" | "semana",
      logrado: number | null,
      minimo: number
    ) => {
      if (logrado === null || !(minimo > 0)) return;
      if (logrado < minimo) faltantes.push({ metrica, periodo, logrado, minimo });
    };
    chequear("llamadas", "dia", c.llamadas, minimos.minDailyCalls);
    chequear("whatsapps", "dia", c.whatsapps, minimos.minDailyWhatsapps);
    chequear("seguimientos", "dia", c.seguimientos, minimos.minDailyFollowUps);
    chequear("visitas", "semana", c.visitas, minimos.minWeeklyVisits);
    if (faltantes.length > 0) out.push({ userId: c.userId, nombre: c.nombre, faltantes });
  }
  return out;
}

/** "Ana: ayer 12 de 20 llamadas, 5 de 30 WhatsApps; la semana pasada 2 de 5 visitas" */
export function textoIncumplimiento(inc: Incumplimiento, ayerLabel: string): string {
  const parte = (periodo: "dia" | "semana") =>
    inc.faltantes
      .filter((f) => f.periodo === periodo)
      .map((f) => `${f.logrado} de ${f.minimo} ${ETIQUETA[f.metrica]}`)
      .join(", ");
  const dia = parte("dia");
  const semana = parte("semana");
  const trozos = [dia && `${ayerLabel} ${dia}`, semana && `la semana pasada ${semana}`].filter(Boolean);
  return `${inc.nombre}: ${trozos.join("; ")}`;
}

// --- Fechas (hora local de Cancún, UTC-5 fijo) ---

function aLocal(d: Date): Date {
  return new Date(d.getTime() + OFFSET_HORAS * 3600_000);
}
function claveDia(local: Date): string {
  return local.toISOString().slice(0, 10);
}
/** Medianoche local (y,m,d) expresada como instante UTC. */
function inicioDiaUtc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d) - OFFSET_HORAS * 3600_000);
}

export interface Ventanas {
  hoyClave: string;
  ayer: { desde: Date; hasta: Date };
  semana: { desde: Date; hasta: Date } | null;
  ayerLabel: string;
}

/**
 * Qué se revisa en `ahora`, o null si hoy no toca (fin de semana o antes de las 8:00 locales).
 * - "Ayer laboral": el día anterior, salvo el lunes, que es el viernes (sábado y domingo no
 *   se revisan, ni corre la revisión esos días).
 * - "Semana": solo los lunes, la semana calendario anterior completa (lunes 00:00 a lunes 00:00).
 */
export function ventanasDeRevision(ahora: Date): Ventanas | null {
  const local = aLocal(ahora);
  if (local.getUTCHours() < HORA_MINIMA_LOCAL) return null;
  const dow = local.getUTCDay(); // 0 dom … 6 sáb
  if (dow === 0 || dow === 6) return null;
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const hoy = inicioDiaUtc(y, m, d);
  const atras = dow === 1 ? 3 : 1;
  const desdeAyer = inicioDiaUtc(y, m, d - atras);
  const hastaAyer = new Date(desdeAyer.getTime() + 24 * 3600_000);
  return {
    hoyClave: claveDia(local),
    ayer: { desde: desdeAyer, hasta: hastaAyer },
    semana: dow === 1 ? { desde: inicioDiaUtc(y, m, d - 7), hasta: hoy } : null,
    ayerLabel: dow === 1 ? "el viernes" : "ayer",
  };
}

function enVentana(desde: Date, hasta: Date, tipos: readonly string[]) {
  const rango = { gte: desde, lt: hasta };
  return {
    deletedAt: null,
    status: "COMPLETADA" as const,
    activityType: { in: [...tipos] },
    // Lo hecho en la ventana: completada en ella, o sin fecha de cierre y creada en ella.
    OR: [{ completedAt: rango }, { completedAt: null, createdAt: rango }],
  };
}

export interface ResultadoRevision {
  omitido?: "fuera_de_horario" | "ya_corrio";
  asesores: number;
  incumplidos: number;
  notificaciones: number;
}

/**
 * Corre UNA vez por día laboral (la última corrida queda en SystemConfig
 * `activity_agreement.last_run`, que se marca ANTES de avisar: si algo falla a la mitad
 * no se repiten avisos cada minuto; se pierde, como mucho, el aviso de ese día).
 *
 * `emitEvent("activity.below_minimum", …)` NO se emite: `emitEvent` solo acepta los
 * entityType contact/deal/conversation/system, no "user".
 */
export async function revisarAcuerdoDeActividad(db: Db, ahora: Date): Promise<ResultadoRevision> {
  const vacio = { asesores: 0, incumplidos: 0, notificaciones: 0 };
  const v = ventanasDeRevision(ahora);
  if (!v) return { omitido: "fuera_de_horario", ...vacio };

  const configs = await db.systemConfig.findMany({
    where: { key: { in: [CLAVE_ACUERDO, CLAVE_ULTIMA_CORRIDA] } },
  });
  const porClave = new Map(configs.map((c) => [c.key, c.value as unknown]));
  const ultima = porClave.get(CLAVE_ULTIMA_CORRIDA) as { dia?: string } | undefined;
  if (ultima?.dia === v.hoyClave) return { omitido: "ya_corrio", ...vacio };

  await db.systemConfig.upsert({
    where: { key: CLAVE_ULTIMA_CORRIDA },
    create: { key: CLAVE_ULTIMA_CORRIDA, value: { dia: v.hoyClave } },
    update: { value: { dia: v.hoyClave } },
  });

  const minimos = resolverMinimos(porClave.get(CLAVE_ACUERDO));

  const asesores = await db.user.findMany({
    where: asesorRuteableWhere() as never,
    select: { id: true, name: true, email: true, plaza: true, teamLeaderId: true },
  });
  const reales = asesores.filter((a) => !esCuentaTecnica(a.email));
  if (reales.length === 0) return vacio;
  const ids = reales.map((a) => a.id);

  const contar = async (desde: Date, hasta: Date, tipos: readonly string[]) => {
    const filas = await db.activity.groupBy({
      by: ["userId"],
      where: { userId: { in: ids }, ...enVentana(desde, hasta, tipos) } as never,
      _count: { _all: true },
    });
    return new Map(filas.map((f) => [f.userId, f._count._all]));
  };

  const dia = v.ayer;
  const [llamadas, whatsapps, seguimientos, visitas] = await Promise.all([
    contar(dia.desde, dia.hasta, TIPOS_LLAMADA),
    contar(dia.desde, dia.hasta, TIPOS_WHATSAPP),
    contar(dia.desde, dia.hasta, TIPOS_SEGUIMIENTO),
    v.semana ? contar(v.semana.desde, v.semana.hasta, TIPOS_VISITA) : Promise.resolve(null),
  ]);

  const incumplimientos = evaluarAcuerdo({
    minimos,
    conteos: reales.map((a) => ({
      userId: a.id,
      nombre: a.name,
      llamadas: llamadas.get(a.id) ?? 0,
      whatsapps: whatsapps.get(a.id) ?? 0,
      seguimientos: seguimientos.get(a.id) ?? 0,
      visitas: visitas ? (visitas.get(a.id) ?? 0) : null,
    })),
  });

  const porId = new Map(reales.map((a) => [a.id, a]));
  const cacheGerencia = new Map<string, string[]>();
  const filas: Array<{ userId: string; title: string; message: string; type: string; link: string }> = [];

  for (const inc of incumplimientos) {
    const asesor = porId.get(inc.userId)!;
    let destinatarios: string[];
    if (asesor.teamLeaderId) {
      destinatarios = [asesor.teamLeaderId];
    } else {
      const k = String(asesor.plaza ?? "");
      if (!cacheGerencia.has(k)) {
        cacheGerencia.set(k, await gerenciaDeLaPlaza((asesor.plaza as string) ?? null));
      }
      destinatarios = cacheGerencia.get(k)!;
    }
    const message = textoIncumplimiento(inc, v.ayerLabel);
    for (const userId of destinatarios) {
      if (userId === inc.userId) continue;
      filas.push({
        userId,
        title: `${inc.nombre} no llegó a los mínimos de actividad`,
        message,
        type: TIPO_NOTIFICACION,
        link: "/reports",
      });
    }
  }

  if (filas.length > 0) await db.notification.createMany({ data: filas });
  return { asesores: reales.length, incumplidos: incumplimientos.length, notificaciones: filas.length };
}

// Agrupación de pendientes por vencimiento — módulo PURO (testeable en node, sin React ni Prisma).
// La zona horaria es fija (America/Cancun) por la misma razón que src/lib/format-date.ts:
// sin tz fija, servidor y navegador discrepan cerca de medianoche y React tira mismatch
// de hidratación. Cancún es UTC−5 sin horario de verano. La constante se importa de
// format-date.ts, que es la fuente única — no se repite el literal.
import { CANCUN_TZ } from "@/lib/format-date";

export type AgendaBucket = "vencidas" | "hoy" | "semana" | "despues" | "sin_fecha";

export interface AgendaItem {
  id: string;
  subject: string;
  activityType: string;
  status: string;
  // ISO 8601 con hora y offset (ej. "2026-07-30T18:00:00Z"), o null si no tiene fecha.
  // Una fecha sin hora ("2026-07-30") se interpreta como medianoche UTC, que en Cancún
  // son las 19:00 del día anterior, y cae un bucket antes. Ese saneo NO se hace aquí —
  // es responsabilidad de la frontera de entrada (la ruta de captura), no de este módulo.
  dueDate: string | null;
  contactId: string | null;
  contactName: string | null;
}

export type AgendaBuckets = Record<AgendaBucket, AgendaItem[]>;

/** Día civil en Cancún como "YYYY-MM-DD". El formato ordena lexicográficamente igual que cronológicamente. */
export function cancunDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CANCUN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Aritmética de calendario sobre la clave de día, sin volver a tocar zonas horarias. */
function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function bucketFor(dueDate: Date | string | null, now: Date): AgendaBucket {
  if (!dueDate) return "sin_fecha";

  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) return "sin_fecha"; // fecha ilegible = fecha no utilizable

  const dueKey = cancunDayKey(parsed);
  const todayKey = cancunDayKey(now);

  if (dueKey < todayKey) return "vencidas";
  if (dueKey === todayKey) return "hoy";
  if (dueKey <= addDaysToKey(todayKey, 6)) return "semana";
  return "despues";
}

export function groupAgenda(items: AgendaItem[], now: Date): AgendaBuckets {
  const buckets: AgendaBuckets = {
    vencidas: [],
    hoy: [],
    semana: [],
    despues: [],
    sin_fecha: [],
  };

  for (const item of items) {
    buckets[bucketFor(item.dueDate, now)].push(item);
  }

  return buckets;
}

/** Orden de presentación y etiqueta visible de cada bucket. */
export const BUCKET_ORDER: AgendaBucket[] = ["vencidas", "hoy", "semana", "despues", "sin_fecha"];

export const BUCKET_LABEL: Record<AgendaBucket, string> = {
  vencidas: "Vencidas",
  hoy: "Hoy",
  semana: "Esta semana",
  despues: "Después",
  sin_fecha: "Sin fecha",
};

export const BUCKET_ACCENT: Record<AgendaBucket, string> = {
  vencidas: "#DC2626",
  hoy: "#D97706",
  semana: "#2563EB",
  despues: "#6B7280",
  sin_fecha: "#6B7280",
};

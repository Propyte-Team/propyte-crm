// Filtro por periodo del índice de la Agenda (HUB #841, referencia: "Mi Actividad abierta"
// de Zoho CRM). Módulo PURO como grouping.ts: sin React ni Prisma, todo sobre el día civil
// de Cancún (misma tz fija que format-date.ts) para no discrepar con los buckets de la vista.
import { cancunDayKey } from "@/lib/agenda/grouping";

export type Periodo =
  | "todas"
  | "hoy_vencido"
  | "hoy"
  | "manana"
  | "vencido"
  | "esta_semana"
  | "siguiente_semana"
  | "este_mes"
  | "siguiente_mes"
  | "fecha";

export const PERIODO_ORDER: Periodo[] = [
  "todas",
  "hoy_vencido",
  "hoy",
  "manana",
  "vencido",
  "esta_semana",
  "siguiente_semana",
  "este_mes",
  "siguiente_mes",
  "fecha",
];

export const PERIODO_LABEL: Record<Periodo, string> = {
  todas: "Todas",
  hoy_vencido: "Hoy y vencido",
  hoy: "Hoy",
  manana: "Mañana",
  vencido: "Vencido",
  esta_semana: "Esta semana",
  siguiente_semana: "Siguiente semana",
  este_mes: "Este mes",
  siguiente_mes: "Siguiente mes",
  fecha: "En fecha específica",
};

function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(key: string, days: number): string {
  const dt = parseKey(key);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Lunes de la semana (lunes–domingo) que contiene la clave de día. */
function mondayOf(key: string): string {
  const dow = parseKey(key).getUTCDay(); // 0 = domingo
  return addDays(key, -((dow + 6) % 7));
}

/** "YYYY-MM" del mes siguiente al de la clave. */
function nextMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * ¿Cae `dueDate` en el periodo? `todas` incluye las tareas sin fecha (principal caso de la
 * captura rápida); el resto las excluye, porque "sin fecha" no está hoy, ni vencida, ni en
 * ninguna semana. `fechaKey` ("YYYY-MM-DD") solo se usa con `fecha`.
 */
export function matchPeriodo(
  dueDate: string | null,
  periodo: Periodo,
  now: Date,
  fechaKey?: string,
): boolean {
  if (periodo === "todas") return true;
  if (!dueDate) return false;

  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) return false;

  const dueKey = cancunDayKey(parsed);
  const today = cancunDayKey(now);

  switch (periodo) {
    case "hoy_vencido":
      return dueKey <= today;
    case "hoy":
      return dueKey === today;
    case "manana":
      return dueKey === addDays(today, 1);
    case "vencido":
      return dueKey < today;
    case "esta_semana": {
      const start = mondayOf(today);
      return dueKey >= start && dueKey <= addDays(start, 6);
    }
    case "siguiente_semana": {
      const start = addDays(mondayOf(today), 7);
      return dueKey >= start && dueKey <= addDays(start, 6);
    }
    case "este_mes":
      return dueKey.slice(0, 7) === today.slice(0, 7);
    case "siguiente_mes":
      return dueKey.slice(0, 7) === nextMonthKey(today);
    case "fecha":
      return !!fechaKey && dueKey === fechaKey;
    default:
      return false;
  }
}

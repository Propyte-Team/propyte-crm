// ============================================================
// Parseo compartido de "dueDate" — hora de pared de Cancún cuando el
// string no trae zona.
//
// Dos bugs distintos motivan este módulo:
//
// Bug A (fecha sin hora): new Date("2026-07-30") es medianoche UTC, que en
// Cancún son las 19:00 del día 29. Una tarea fechada el 30 se guardaría el 29.
//
// Bug B (el grave — datetime local sin offset): new Date("2026-07-30T14:30")
// se interpreta según la zona horaria DEL PROCESO que ejecuta el código, no
// la del usuario ni la del negocio. El mismo input produce instantes
// distintos en desarrollo (proceso en America/Mexico_City) y en producción
// (proceso en UTC, típico de contenedores Linux). Un <input type="datetime-local">
// manda exactamente ese formato crudo — ver stage-transition-dialog.tsx.
//
// La regla: si el string no trae información de zona, es hora de pared de
// Cancún. Si la trae (Z o ±HH:MM/±HHMM), se respeta tal cual. Esto hace el
// resultado independiente de la zona del proceso — la misma razón por la
// que src/lib/format-date.ts fija CANCUN_TZ para el formateo.
// ============================================================

import { z } from "zod";
import { CANCUN_TZ } from "@/lib/format-date";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const PARTE_FECHA = /^(\d{4})-(\d{2})-(\d{2})/;

// Zona explícita al final del string: "Z" literal, o un offset ±HH:MM /
// ±HHMM (colon opcional). Requerir las 4 cifras del offset completo (no solo
// "termina en signo+dígitos") es lo que evita el falso positivo con
// "2026-07-30": su cola "-30" solo tiene 2 dígitos tras el signo, no los 4
// de un offset real, así que nunca matchea.
const TIENE_ZONA = /(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Offset de Cancún en el instante dado, como "-05:00", derivado del
 * identificador IANA en vez de hardcodearlo. `America/Cancun` ya resuelve
 * DST vía Intl si México lo reinstaurara algún día — un offset fijo escrito
 * a mano no, y se desfasaría en silencio cerca de medianoche.
 */
function cancunOffset(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CANCUN_TZ,
    timeZoneName: "longOffset",
  }).formatToParts(at);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return name.replace("GMT", "") || "+00:00";
}

/**
 * "30 de febrero no existe" es cierto en toda zona horaria — no depende de
 * Cancún ni de ninguna otra. Se valida por separado del anclaje de zona:
 * el parser de fechas de JS hace rollover silencioso en fechas de calendario
 * imposibles ("2026-02-30" → 2 de marzo, con o sin hora), y validar esto
 * contra el offset de Cancún produciría falsos rechazos en la rama con hora
 * (ej. "2026-07-30T02:00:00Z" es el 29 en Cancún pero un día real en UTC).
 */
function esDiaDeCalendarioReal(value: string): boolean {
  const m = PARTE_FECHA.exec(value);
  if (!m) return true; // sin parte de fecha reconocible, que decida el parser
  const y = Number(m[1]);
  const mes = Number(m[2]);
  const d = Number(m[3]);
  const sonda = new Date(Date.UTC(y, mes - 1, d));
  return (
    sonda.getUTCFullYear() === y && sonda.getUTCMonth() === mes - 1 && sonda.getUTCDate() === d
  );
}

/**
 * Parsea un "dueDate" entrante (fecha sola o datetime, con o sin zona).
 *
 * - El <input type="date"> del cliente manda "YYYY-MM-DD" sin hora.
 *   Interpretarlo como medianoche UTC lo correría a las 19:00 del día
 *   anterior en Cancún. Se ancla a medianoche de Cancún.
 * - El <input type="datetime-local"> manda "YYYY-MM-DDTHH:mm[:ss]" sin
 *   zona. Interpretarlo con `new Date(value)` a secas lo deja a merced de
 *   la zona del proceso (bug B). Se ancla con la hora de pared de Cancún.
 * - Un string que SÍ trae zona (Z o ±HH:MM/±HHMM) pasa intacto — ya es un
 *   instante inequívoco, no hay nada que anclar.
 *
 * La regla vive SOLO aquí, en la frontera donde el string entra al sistema —
 * duplicarla en el módulo de agrupación (src/lib/agenda/grouping.ts) la
 * haría divergir.
 */
export function parseDueDate(value: string): Date | null {
  if (!esDiaDeCalendarioReal(value)) return null;

  if (DATE_ONLY.test(value)) {
    // Mediodía UTC como instante de sondeo para el offset: evita caer justo
    // en un borde de cambio de horario si algún día lo hubiera.
    const offset = cancunOffset(new Date(`${value}T12:00:00Z`));
    const anchored = new Date(`${value}T00:00:00${offset}`);
    return Number.isNaN(anchored.getTime()) ? null : anchored;
  }

  if (TIENE_ZONA.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // Sin zona y no es solo fecha: datetime local (u otra cosa no parseable).
  // Se ancla con el offset de Cancún pegado directamente al final del string
  // tal cual vino, conservando su propia hora. Si `value` no tiene una parte
  // de fecha reconocible (garbage), se usa "ahora" como instante de sondeo
  // para el offset — el resultado de todos modos será Invalid Date más abajo.
  const m = PARTE_FECHA.exec(value);
  const offset = cancunOffset(m ? new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`) : new Date());
  const anchored = new Date(`${value}${offset}`);
  return Number.isNaN(anchored.getTime()) ? null : anchored;
}

/** Esquema zod reutilizable: string de entrada → Date anclada a Cancún. */
export const dueDateSchema = z
  .string()
  .transform((value) => parseDueDate(value))
  .refine((d): d is Date => d !== null, { message: "Fecha inválida" });

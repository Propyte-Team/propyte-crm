// src/lib/workflows/business-hours.ts
// Calculadora de vencimiento SLA por minutos hábiles. PURA, sin BD.
// businessHours vacío/sin días abiertos → wall-clock (start + minutes).
// Supuesto: la tz no observa DST (México desde 2022) → offset constante.
// Solo ventanas diurnas (apertura < cierre). Ventanas nocturnas (cierre < apertura) NO están soportadas.

export interface BusinessHours {
  tz?: string;
  days?: Record<string, [number, number] | null>; // "0".."6" (0=domingo) → [aperturaMin, cierreMin] o null (cerrado)
}

const DAY_MS = 24 * 60 * 60000;

function tzOffsetMinutes(at: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const m: Record<string, number> = {};
  for (const p of dtf.formatToParts(at)) if (p.type !== "literal") m[p.type] = Number(p.value);
  const asUTC = Date.UTC(m.year, m.month - 1, m.day, m.hour % 24, m.minute, m.second);
  return (asUTC - at.getTime()) / 60000;
}

function atMidnightNextDay(d: Date): Date {
  const n = new Date(d.getTime());
  n.setUTCHours(0, 0, 0, 0);
  return new Date(n.getTime() + DAY_MS);
}
function setMinutesOfDay(d: Date, minutesOfDay: number): Date {
  const n = new Date(d.getTime());
  n.setUTCHours(0, 0, 0, 0);
  return new Date(n.getTime() + minutesOfDay * 60000);
}

export function computeDueAt(startAt: Date, minutes: number, businessHours: BusinessHours | null | undefined): Date {
  if (minutes <= 0) return new Date(startAt.getTime() + minutes * 60000);
  const days = businessHours?.days;
  const tz = businessHours?.tz;
  const hasSchedule = !!tz && !!days && Object.values(days).some((w) => Array.isArray(w));
  const wallClock = () => new Date(startAt.getTime() + minutes * 60000);
  if (!hasSchedule) return wallClock();

  let offset: number;
  try {
    offset = tzOffsetMinutes(startAt, tz!);
  } catch {
    console.warn(`[sla] computeDueAt: timezone inválida "${tz}"; fallback wall-clock`);
    return wallClock();
  }
  let cur = new Date(startAt.getTime() + offset * 60000);
  let remaining = minutes;
  let safety = 0;

  while (remaining > 0) {
    // Cada iteración avanza como máximo un día. 20000 ≈ 54 años de días hábiles:
    // inalcanzable con SLAs reales. Si se alcanza, la config es errónea → wall-clock + aviso.
    if (safety++ > 20000) { console.warn(`[sla] computeDueAt: businessHours sin ventanas suficientes; fallback wall-clock`); return wallClock(); }
    const win = days![String(cur.getUTCDay())];
    if (!Array.isArray(win)) { cur = atMidnightNextDay(cur); continue; }
    const [open, close] = win;
    const mod = cur.getUTCHours() * 60 + cur.getUTCMinutes();
    if (mod < open) { cur = setMinutesOfDay(cur, open); continue; }
    if (mod >= close) { cur = atMidnightNextDay(cur); continue; }
    const avail = close - mod;
    if (remaining <= avail) { cur = new Date(cur.getTime() + remaining * 60000); remaining = 0; }
    else { remaining -= avail; cur = atMidnightNextDay(cur); }
  }
  return new Date(cur.getTime() - offset * 60000);
}

/**
 * Agenda de reserva: 09-18, hora de Cancún, cerrado el domingo.
 *
 * Es exactamente la definición que `engine.ts` tenía hardcodeada (#680), reescrita en la
 * misma estructura que `computeDueAt` ya consume. Se conserva para NO cambiar el
 * comportamiento cuando no hay política configurada — pero como agenda por defecto
 * declarada, no como una segunda definición paralela que nadie puede ajustar.
 *
 * Ojo al leerla: el sábado ("6") está ABIERTO. Eso es lo que hacía el código anterior
 * (`day !== 0` excluye solo el domingo) y es justo la divergencia que la tarjeta reporta
 * contra una SlaPolicy que cierre sábados. Al configurar una política, esta agenda deja de
 * aplicarse y la política manda.
 */
export const HORARIO_POR_DEFECTO: BusinessHours = {
  tz: "America/Cancun",
  days: {
    "0": null,          // domingo cerrado
    "1": [9 * 60, 18 * 60],
    "2": [9 * 60, 18 * 60],
    "3": [9 * 60, 18 * 60],
    "4": [9 * 60, 18 * 60],
    "5": [9 * 60, 18 * 60],
    "6": [9 * 60, 18 * 60], // sábado ABIERTO: lo que hacía engine.ts
  },
};

/**
 * ¿Este instante cae dentro del horario laboral de esta agenda? (#680)
 *
 * Había DOS definiciones de horario laboral en el repositorio y no se hablaban: la
 * configurable de `SlaPolicy.businessHours`, que alimenta a `computeDueAt` y decide los
 * plazos de los relojes de atención; y una escrita a mano en `engine.ts:77-83` que
 * alimentaba `context.isBusinessHours` del DSL de reglas. La segunda fijaba 09-18 en
 * América/Cancún, contaba el sábado como laborable e ignoraba la política por completo, así
 * que una regla podía disparar un sábado a las cinco mientras el reloj de atención
 * —configurado sin sábados— consideraba que la oficina estaba cerrada. Su propio comentario
 * se declaraba provisional: «afinable por SlaPolicy.businessHours en F2.1».
 *
 * Ahora las dos salen de la misma estructura. Sin agenda válida devuelve `null`, que
 * significa "no se puede saber": eso es distinto de `false` y quien llama decide. Devolver
 * `false` a ciegas haría que una regla condicionada a horario de oficina nunca dispare, y
 * eso es peor que el bug, porque no deja rastro.
 *
 * Comparte los supuestos de `computeDueAt` y por las mismas razones: la zona no observa DST
 * (México desde 2022) y solo se soportan ventanas diurnas (apertura < cierre).
 */
export function estaEnHorarioLaboral(
  at: Date,
  businessHours: BusinessHours | null | undefined
): boolean | null {
  const days = businessHours?.days;
  const tz = businessHours?.tz;
  const hasSchedule = !!tz && !!days && Object.values(days).some((w) => Array.isArray(w));
  if (!hasSchedule) return null;

  let offset: number;
  try {
    offset = tzOffsetMinutes(at, tz!);
  } catch {
    console.warn(`[workflows] estaEnHorarioLaboral: timezone inválida "${tz}"`);
    return null;
  }

  // Mismo truco que computeDueAt: se corre el instante por el offset y se lee en UTC, así
  // el día de la semana y los minutos del día son los de la zona de la agenda.
  const local = new Date(at.getTime() + offset * 60000);
  const win = days![String(local.getUTCDay())];
  if (!Array.isArray(win)) return false; // día cerrado

  const [open, close] = win;
  const minutesOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minutesOfDay >= open && minutesOfDay < close;
}

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

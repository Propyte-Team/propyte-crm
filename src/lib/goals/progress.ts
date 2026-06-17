/** Suma N meses en UTC (evita desfase por timezone local). */
function addMonthsUTC(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}

/** Rango [start, end) del mes que arranca en `period` (1er día del mes). */
export function monthRange(period: Date): { start: Date; end: Date } {
  return { start: period, end: addMonthsUTC(period, 1) };
}

export type GoalStatus = "met" | "on_track" | "behind";

/** % de avance (0..100+) y estado. target<=0 → pct 0 (evita /0). */
export function computeGoalProgress(
  target: number,
  actual: number
): { pct: number; status: GoalStatus } {
  if (target <= 0) return { pct: 0, status: "behind" };
  const pct = Math.round((actual / target) * 100);
  const status: GoalStatus = actual >= target ? "met" : pct >= 70 ? "on_track" : "behind";
  return { pct, status };
}

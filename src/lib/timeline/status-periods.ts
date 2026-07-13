// Misma semántica que la vista SQL v_contact_status_periods (ver migración
// 2026-07-13-cronologia-field-changes.sql): un período inicial desde createdAt con el
// `oldValue` del primer cambio, luego un período por cambio (el `newValue` de ese cambio
// hasta el siguiente changedAt), y el último período queda abierto (exitedAt=null,
// duración calculada contra `now()`) usando el `currentStatus` vigente del contacto.

export interface StatusChangeInput {
  oldValue: unknown;
  newValue: unknown;
  changedAt: Date;
}

export interface StatusPeriod {
  status: string;
  enteredAt: string;
  exitedAt: string | null;
  durationMs: number;
}

// El campo viene de una columna Json (jsonb) — para un enum/texto Prisma decodifica el
// primitivo directo (string). Defensivo ante null/undefined/otros tipos.
function valueToStatus(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  return typeof value === "string" ? value : String(value);
}

export function computeStatusPeriods(
  changes: StatusChangeInput[],
  createdAt: Date,
  currentStatus: string
): StatusPeriod[] {
  const now = new Date();

  if (changes.length === 0) {
    return [
      {
        status: currentStatus,
        enteredAt: createdAt.toISOString(),
        exitedAt: null,
        durationMs: now.getTime() - createdAt.getTime(),
      },
    ];
  }

  const sorted = [...changes].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  const periods: StatusPeriod[] = [];

  // Período inicial: createdAt → primer cambio, con el estado que tenía antes de ese cambio.
  periods.push({
    status: valueToStatus(sorted[0].oldValue, currentStatus),
    enteredAt: createdAt.toISOString(),
    exitedAt: sorted[0].changedAt.toISOString(),
    durationMs: sorted[0].changedAt.getTime() - createdAt.getTime(),
  });

  // Un período por cambio: entra en changedAt, sale en el siguiente changedAt (o abierto).
  for (let i = 0; i < sorted.length; i++) {
    const change = sorted[i];
    const next = sorted[i + 1];
    const isLast = i === sorted.length - 1;
    const enteredAt = change.changedAt;
    const exitedAt = next ? next.changedAt : null;
    const durationMs = (exitedAt ?? now).getTime() - enteredAt.getTime();

    periods.push({
      // El último período abierto usa currentStatus (fuente de verdad vigente) en vez del
      // newValue registrado, por si hubiera drift entre la tabla de cambios y el contacto.
      status: isLast ? currentStatus : valueToStatus(change.newValue, currentStatus),
      enteredAt: enteredAt.toISOString(),
      exitedAt: exitedAt ? exitedAt.toISOString() : null,
      durationMs,
    });
  }

  return periods;
}

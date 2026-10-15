// Rango de fechas de los reportes, en días civiles de Cancún (#893).
//
// Los filtros «Fecha desde / hasta» son <input type="date">: mandan "YYYY-MM-DD" sin hora.
// Antes se convertían con `new Date(valor)`, que es medianoche UTC = 19:00 del día ANTERIOR en
// Cancún, y el «hasta» se aplicaba con `lte`. Resultado: el último día del rango quedaba fuera
// casi entero y los dos límites se corrían 5 horas.
//
// Ahora:
//   desde → `gte` medianoche de Cancún de ese día
//   hasta → `lt`  medianoche de Cancún del día SIGUIENTE (incluye el día completo)
//
// El anclaje a Cancún no se reescribe aquí: lo hace `parseDueDate`, que es la regla única de
// «fecha sin hora → medianoche de Cancún». Una fecha que no sea "YYYY-MM-DD" válida se RECHAZA
// en vez de adivinarse (un rango equivocado en silencio es peor que un error).
//
// Módulo puro.

import { parseDueDate } from "@/lib/due-date";

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const FECHA_INVALIDA_REPORTE = "Fecha inválida en el filtro del reporte";

export interface RangoFechas {
  gte?: Date;
  lt?: Date;
}

/** "2026-10-15" → "2026-10-16". Aritmética de calendario pura, sin zonas horarias. */
function diaSiguiente(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function anclar(dia: string): Date {
  const fecha = SOLO_FECHA.test(dia) ? parseDueDate(dia) : null;
  if (!fecha) throw new Error(FECHA_INVALIDA_REPORTE);
  return fecha;
}

/**
 * Convierte los filtros del reporte en un rango para Prisma (`{ gte, lt }`).
 * `undefined` si no hay ninguna de las dos fechas.
 */
export function rangoDeFechas(desde?: string | null, hasta?: string | null): RangoFechas | undefined {
  if (!desde && !hasta) return undefined;
  const rango: RangoFechas = {};
  if (desde) rango.gte = anclar(desde);
  if (hasta) {
    anclar(hasta); // valida el día pedido antes de pasar al siguiente ("2026-02-30" no existe)
    rango.lt = anclar(diaSiguiente(hasta));
  }
  return rango;
}

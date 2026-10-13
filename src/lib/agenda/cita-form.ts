// Ayudas puras del formulario de reuniones y llamadas de la Agenda (HUB #857 / #859).

import { CANCUN_TZ } from "@/lib/format-date";

/**
 * Instante ISO -> valor de un <input type="datetime-local"> ("YYYY-MM-DDTHH:mm") en hora de
 * Cancún, que es la zona en que el servidor ancla esos strings (lib/due-date). Al editar una
 * cita, el campo debe mostrar la hora de Cancún y no la del navegador, o guardar sin tocar
 * nada la correría si el asesor está en otra zona. Devuelve "" si no hay fecha válida.
 */
export function aDatetimeLocalCancun(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CANCUN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

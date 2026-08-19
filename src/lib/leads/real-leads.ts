// Qué cuenta como lead en los tableros y qué no.
//
// Un contacto nacido de un comentario existe porque le escribimos NOSOTROS un
// DM automático, no porque haya levantado la mano. `captureLead` lo da de alta
// como provisional justo por eso: sin ruteo, sin SLA y sin evento Lead de Meta
// CAPI (ver lib/intake/capture-lead.ts). Pero la marca de provisional solo la
// leía el ruteo del primer reply, así que en /reportes, el tablero y las metas
// seguía contando como "lead de Instagram" gente que nunca contestó — el número
// que Luis usa para medir campañas quedaba inflado con puertas que tocamos
// nosotros.
//
// Cuando la persona SÍ contesta se convierte en un lead de verdad (el intake lo
// rutea y sube a MQL), y entonces vuelve a contar. La señal de que contestó es
// tener al menos un mensaje INBOUND: es la definición literal de "levantó la
// mano" y no depende de que el ruteo encontrara asesor disponible.
//
// Lo que este filtro NO hace: esconder al contacto. En Contactos y en el Inbox
// los provisionales se siguen viendo enteros — son personas reales a las que ya
// les escribimos. Lo único que se les quita es contar como lead captado.
import type { Prisma } from "@prisma/client";
import { COMMENT_ORIGIN_PREFIX } from "@/lib/comments/link-comment-origin";

/**
 * Contacto provisional nacido de un comentario que todavía no contesta.
 *
 * Las dos condiciones van en UN objeto a propósito: se niega la conjunción. Con
 * dos `NOT` separados se negaría cada una por su lado y el filtro se llevaría
 * por delante a cualquier contacto sin inbound, viniera de un comentario o no.
 */
export const PROVISIONAL_COMMENT_LEAD: Prisma.ContactWhereInput = {
  leadSourceDetail: { startsWith: COMMENT_ORIGIN_PREFIX },
  messages: { none: { direction: "INBOUND" } },
};

/**
 * Envuelve un filtro de contactos para que cuente solo leads reales.
 *
 * Existe como función y no como constante para difundir por un solo lugar: cada
 * tablero arma su propio `where` (fechas, dueño, plaza) y lo único que tienen
 * que recordar es pasarlo por aquí. Un `NOT` que ya viniera en el filtro se
 * conserva —se combinan en arreglo— porque sobrescribirlo sería perder una
 * condición sin ningún síntoma visible.
 */
export function realLeadWhere(base: Prisma.ContactWhereInput): Prisma.ContactWhereInput {
  const previous = base.NOT;
  if (previous === undefined || previous === null) {
    return { ...base, NOT: PROVISIONAL_COMMENT_LEAD };
  }
  return {
    ...base,
    NOT: [...(Array.isArray(previous) ? previous : [previous]), PROVISIONAL_COMMENT_LEAD],
  };
}

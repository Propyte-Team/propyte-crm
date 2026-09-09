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
 *
 * ## Por qué también excluye los borrados (#682)
 *
 * Antes solo quitaba los provisionales de comentario, y cada llamador tenía que
 * acordarse de añadir `deletedAt: null` por su cuenta. Cinco de los nueve sitios
 * se acordaban (goals, dashboard ×2, today ×2, reports) y cuatro no (pulso ×3,
 * anomalias). Medido en producción el 2026-09-08: **18 de 131 contactos tienen
 * `deletedAt`**, o sea el 14%, así que los cuatro que no filtraban devolvían un
 * número inflado en ese orden de magnitud.
 *
 * Lo llamativo es que el comentario de `pulso.ts` justificaba usar esta función
 * precisamente para que su número «no contradiga al que el equipo mira en
 * pantalla» — y como el tablero sí añadía `deletedAt: null` y pulso no, los dos
 * números nunca coincidieron. Ponerlo aquí es lo único que cumple esa promesa.
 *
 * Un contacto borrado no es un lead: eso no es una decisión de negocio, es lo que
 * significa el borrado lógico. Los llamadores que ya pasaban `deletedAt: null`
 * siguen igual —la condición se repite y no cambia nada— y se dejan tal cual
 * porque documentan la intención en el sitio donde se lee la consulta.
 */
export function realLeadWhere(base: Prisma.ContactWhereInput): Prisma.ContactWhereInput {
  const withBase: Prisma.ContactWhereInput = { deletedAt: null, ...base };
  const previous = withBase.NOT;
  if (previous === undefined || previous === null) {
    return { ...withBase, NOT: PROVISIONAL_COMMENT_LEAD };
  }
  return {
    ...withBase,
    NOT: [...(Array.isArray(previous) ? previous : [previous]), PROVISIONAL_COMMENT_LEAD],
  };
}

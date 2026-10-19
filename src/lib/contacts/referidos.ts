// Referidos del broker (#907): reglas puras, sin base de datos, para que la ficha, la API y las
// pruebas usen exactamente las mismas.
import type { Prisma } from "@prisma/client";
import { CONTACT_TYPE_BROKER } from "@/lib/constants";

/**
 * ¿El alcance por ROL deja abrir un contacto con este dueño? Es la comparación que
 * `getContact` y `getContactAccessInfo` hacían cada uno por su lado (copiada idéntica), sacada
 * aquí porque la ficha del broker necesita una tercera: decidir cuáles de sus referidos se
 * pueden abrir con un clic. Misma semántica, sin cambiarle nada:
 *
 *  - alcance propio (`assignedToId = yo`): solo los míos;
 *  - alcance de equipo (`assignedToId in [...]`): los del equipo y los que no tienen dueño;
 *  - cualquier otro alcance (total, plaza vía `OR`, solo lectura): no restringe aquí.
 *
 * NO incluye la visibilidad por marca: esa se comprueba aparte con `canSeeContactBrand`.
 */
export function rbacPermiteContacto(
  assignedToId: string | null,
  rbacFilter: Prisma.ContactWhereInput,
): boolean {
  const filtro = rbacFilter.assignedToId;
  if (!filtro) return true;
  if (typeof filtro === "string") return assignedToId === filtro;
  if (typeof filtro === "object" && "in" in filtro && Array.isArray(filtro.in)) {
    return !assignedToId || (filtro.in as string[]).includes(assignedToId);
  }
  return true;
}

/**
 * Parte los referidos de un broker en los que quien mira puede abrir y cuántos no. Los que no
 * puede abrir NO se nombran (serían contactos de otro asesor o de otra marca): solo se cuentan,
 * para que la ficha diga «y N más» en vez de esconder que existen.
 */
export function separarReferidos<T>(
  referidos: readonly T[],
  puedeVer: (r: T) => boolean,
): { visibles: T[]; ocultos: number } {
  const visibles = referidos.filter(puedeVer);
  return { visibles, ocultos: referidos.length - visibles.length };
}

/** Cuántos referidos trae la ficha del broker como máximo (ordenados del más nuevo). */
export const MAX_REFERIDOS_EN_FICHA = 500;

export type MotivoReferidoInvalido = "mismo_contacto" | "no_existe" | "no_es_broker";

export const MENSAJE_REFERIDO_INVALIDO: Record<MotivoReferidoInvalido, string> = {
  mismo_contacto: "Un contacto no puede ser referido por sí mismo",
  // «No existe» y «no tienes acceso» dan el MISMO mensaje: distinguirlos confirmaría que
  // existe un contacto con ese id fuera de tu alcance (mismo criterio que el 404 de la ficha).
  no_existe: "El broker elegido no existe",
  no_es_broker: "Solo se puede elegir un contacto de tipo Broker",
};

/**
 * ¿Se puede guardar `referredById` en este contacto? `broker` es lo que se encontró con ese id
 * (null si no existe, está borrado o quien edita no lo ve). Devuelve null si es válido.
 */
export function validarReferidoPor(opts: {
  contactId: string | null; // null al crear
  referredById: string;
  broker: { id: string; contactType: string | null } | null;
}): MotivoReferidoInvalido | null {
  if (opts.contactId && opts.referredById === opts.contactId) return "mismo_contacto";
  if (!opts.broker) return "no_existe";
  if (opts.broker.contactType !== CONTACT_TYPE_BROKER) return "no_es_broker";
  return null;
}

/** Nombre para mostrar de un contacto ligado (broker o referido). */
export function nombreDeContacto(c: { firstName?: string | null; lastName?: string | null }): string {
  return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Sin nombre";
}

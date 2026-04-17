/**
 * Tie-breaker jerarquico para resolver valores canonicos cuando varias properties
 * del mismo desarrollo reportan datos distintos.
 *
 * Orden de prioridad:
 *   1. status='published' > 'review'  (limpio por Felipe > aun contaminado)
 *   2. whitelist de sources ordenada por confianza
 *   3. last_seen_at DESC  (mas reciente gana dentro del mismo source)
 *   4. fallback: primer valor no-null
 *
 * Para campos SENSIBLES (description, fotos, telefonos, URLs): solo considerar
 * properties con status='published'. Si ninguna esta published, devolver null
 * (mejor vacio que contaminado con data de rival).
 */

import { FIELD_SENSITIVITY } from "./field-sensitivity";
import type { PropertyStatus } from "./types";

/**
 * Orden descendente de confianza por status.
 * - 'published' = humano de Felipe limpio contaminacion de competidores
 * - 'review'    = humano empezo a revisar pero aun puede tener data rival
 * - otros no se consideran (draft se filtra en el WHERE del Robot 1)
 */
export const STATUS_PRIORITY: readonly PropertyStatus[] = ["published", "review"] as const;

/**
 * Orden descendente de confianza por source domain.
 * Revisar y ajustar despues de primera corrida con datos reales.
 * Nota: match se hace por includes() del domain.
 */
export const SOURCE_PRIORITY: readonly string[] = [
  "goodlers.com",
  "propiedadescancun.mx",
  "listing.caribeluxuryhomes.com",
  "plalla.com",
  "luumorealestate.com",
  "novalproperties.com",
] as const;

export interface Candidate<T> {
  propertyId: string;
  sourceDomain: string;
  status: PropertyStatus;
  lastSeenAt: Date;
  value: T | null;
}

function indexOfSource(domain: string): number {
  for (let i = 0; i < SOURCE_PRIORITY.length; i++) {
    if (domain.includes(SOURCE_PRIORITY[i])) return i;
  }
  return SOURCE_PRIORITY.length;
}

function indexOfStatus(status: PropertyStatus): number {
  const idx = STATUS_PRIORITY.indexOf(status);
  return idx === -1 ? STATUS_PRIORITY.length : idx;
}

/**
 * Elige el valor canonico entre varios candidatos aplicando el tie-breaker.
 *
 * @param items   candidatos con status/source/lastSeen/value
 * @param field   nombre del campo (ej 'nombre_desarrollo', 'latitude'). Si aparece
 *                en SENSITIVE_FIELDS, solo considera candidatos con status=published.
 * @returns valor ganador o null
 */
export function winnerByFieldSensitivity<T>(
  items: Candidate<T>[],
  field: string
): T | null {
  const sensitive = FIELD_SENSITIVITY.isSensitive(field);

  // Filtra candidatos admisibles
  let admissible = items.filter((c) => c.value !== null && c.value !== undefined);
  if (sensitive) {
    admissible = admissible.filter((c) => c.status === "published");
  }
  if (admissible.length === 0) return null;

  // Sort por tie-breaker
  admissible.sort((a, b) => {
    const statusDiff = indexOfStatus(a.status) - indexOfStatus(b.status);
    if (statusDiff !== 0) return statusDiff;

    const sourceDiff = indexOfSource(a.sourceDomain) - indexOfSource(b.sourceDomain);
    if (sourceDiff !== 0) return sourceDiff;

    return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
  });

  return admissible[0].value ?? null;
}

// #959 — Reclutamiento y Contactos ligados: reglas PURAS (sin Prisma) para el alta de un candidato
// que todavía no es contacto. Las mismas que el llenado de la migración
// prisma/migrations-manual/2026-11-03-reclutamiento-contactos.sql (contacto.test.ts las fija).
import type { Plaza } from "@prisma/client";

/** Estado con el que nace en Contactos quien llega por Reclutamiento: fuera del embudo de ventas. */
export const ESTADO_CONTACTO_RECLUTAMIENTO = "DERIVADO_A_RH" as const;
/** Etiqueta de los contactos que crea el alta de Reclutamiento. */
export const ETIQUETA_CONTACTO_RECLUTAMIENTO = "reclutamiento";
export const DETALLE_ORIGEN_RECLUTAMIENTO = "Reclutamiento (alta manual)";

/**
 * Nombre completo → nombre y apellidos. Con 4 palabras o más, las dos primeras son el nombre
 * («Jesús Rafael | Torres Lizama», «Dany A. | Torres Calvo»); con menos, solo la primera
 * («Javier | Martínez Reyes»). Nunca deja el nombre vacío.
 */
export function partirNombre(fullName: string): { firstName: string; lastName: string } {
  const w = fullName.trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return { firstName: "Sin nombre", lastName: "" };
  const n = w.length >= 4 ? 2 : 1;
  return { firstName: w.slice(0, n).join(" "), lastName: w.slice(n).join(" ") };
}

const PLAZAS_CRM: readonly string[] = ["PDC", "TULUM", "MERIDA"];

/** Ubicación de Reclutamiento → plaza del CRM. Cancún, Remoto y Foráneo no son plazas: null. */
export function plazaDelCrm(ubicacion: string | null | undefined): Plaza | null {
  return ubicacion && PLAZAS_CRM.includes(ubicacion) ? (ubicacion as Plaza) : null;
}

/** Últimos 10 dígitos del teléfono (la llave con que se cruza contra Contactos), o null. */
export function telefonoLlave(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

/** Entre los contactos que coinciden, primero el que ya es Empleo; si no, el más antiguo. */
export function elegirContacto<T extends { contactType: string | null; createdAt: Date }>(xs: T[]): T | null {
  if (xs.length === 0) return null;
  return [...xs].sort((a, b) => {
    const ea = a.contactType === "EMPLEO" ? 0 : 1;
    const eb = b.contactType === "EMPLEO" ? 0 : 1;
    return ea - eb || a.createdAt.getTime() - b.createdAt.getTime();
  })[0];
}

/** El alta manual encontró a la persona ya en Reclutamiento (por su contacto). */
export class CandidatoYaExiste extends Error {
  constructor(public readonly fullName: string) {
    super(`Esta persona ya está en Reclutamiento como «${fullName}». Búscala en la tabla.`);
    this.name = "CandidatoYaExiste";
  }
}

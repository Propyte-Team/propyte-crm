// #926 — Quién entra a Reclutamiento. Módulo mínimo y PURO: lo importan el sidebar
// (nav-config), la página y la API, para que el menú y la puerta no se separen.
//
// Son datos personales de candidatos (LFPDPPP): por defecto solo dirección y gerencia.
// Fail-closed: un rol ausente o desconocido no entra.

/** Ven y editan candidatos (ADMIN entra siempre, igual que en el resto del CRM). */
export const RECLUTAMIENTO_ROLES = ["ADMIN", "DIRECTOR", "GERENTE"] as const;

/** Además de editar, pueden eliminar un candidato o cualquier CV. */
export const RECLUTAMIENTO_BORRAN = ["ADMIN", "DIRECTOR"] as const;

export function puedeVerReclutamiento(role: string | null | undefined): boolean {
  return !!role && (RECLUTAMIENTO_ROLES as readonly string[]).includes(role);
}

export function puedeEliminarEnReclutamiento(role: string | null | undefined): boolean {
  return !!role && (RECLUTAMIENTO_BORRAN as readonly string[]).includes(role);
}

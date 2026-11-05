// #988 — Quién edita las plantillas de Copilot y quién ve el tablero de vencidas.
// Lógica pura, para servidor y cliente.

/** Editan los textos: dirección comercial, gerencia, Marketing (escribe las cifras) y Admin. */
export const ROLES_EDITAN_PLANTILLAS = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"] as const;

export function puedeEditarPlantillas(role: string | null | undefined): boolean {
  return !!role && (ROLES_EDITAN_PLANTILLAS as readonly string[]).includes(role);
}

/** Ven el tablero de vencidas: los mandos y el líder de equipo (de su equipo). */
export const ROLES_VEN_VENCIDAS = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER"] as const;

export function puedeVerVencidas(role: string | null | undefined): boolean {
  return !!role && (ROLES_VEN_VENCIDAS as readonly string[]).includes(role);
}

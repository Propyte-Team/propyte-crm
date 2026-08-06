// src/lib/inbox/roles.ts
// Roles del Inbox — DOS sets a propósito (no unificar):
// - FULL_VIEW: quién ve TODO el inbox en la lista. TEAM_LEADER queda FUERA
//   deliberadamente: sigue viendo solo sus hilos + sin asignar (cero ampliación
//   de alcance, lección del reorden RBAC de af41c4f).
// - MANAGERS: quién ejecuta acciones de mando (asignar/reasignar/quitar, takeover
//   de hilos ajenos). TEAM_LEADER SÍ está: reparte la cola "sin asignar" a su
//   equipo sin que se le amplíe la vista.
export const INBOX_FULL_VIEW = ["ADMIN", "DIRECTOR", "GERENTE"] as const;
export const INBOX_MANAGERS = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER"] as const;

export function hasInboxFullView(role: string): boolean {
  return (INBOX_FULL_VIEW as readonly string[]).includes(role);
}

export function isInboxManager(role: string): boolean {
  return (INBOX_MANAGERS as readonly string[]).includes(role);
}

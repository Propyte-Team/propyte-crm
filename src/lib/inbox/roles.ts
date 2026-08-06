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

// Quién puede SER dueño de un contacto desde el inbox (reclamar o recibir asignación).
// Espejo del default de reparto de leads del routing (workflows/routing.ts:92) más el
// mando, que también atiende hilos. Roles como HOSTESS/MARKETING/DEVELOPER_EXT/BROKER
// quedan fuera a propósito: pueden ver el inbox, no adueñarse de un lead.
export const INBOX_CLAIMERS = ["ASESOR", "ASESOR_SR", "ASESOR_JR"] as const;

export function hasInboxFullView(role: string): boolean {
  return (INBOX_FULL_VIEW as readonly string[]).includes(role);
}

export function isInboxManager(role: string): boolean {
  return (INBOX_MANAGERS as readonly string[]).includes(role);
}

export function canOwnInboxContact(role: string): boolean {
  return isInboxManager(role) || (INBOX_CLAIMERS as readonly string[]).includes(role);
}

// Quién puede gestionar las reglas de comentarios sociales — módulo PURO
// (testeable en node, sin React/Next/Prisma).
//
// Esta lista vivía copiada en las 5 rutas de /api/admin/comment-rules. Se
// centralizó al abrirle la feature a MARKETING (ago-2026): cinco copias son
// cinco oportunidades de que una se quede atrás y deje un hueco.
//
// Por qué entra MARKETING: la UI vivía SOLO en /admin?tab=comments, cuyo guard
// es [ADMIN, DIRECTOR, GERENTE], y la API se pareó a esa página a propósito
// para no conceder más de lo que la página deja ver. Ahora la feature también
// tiene puerta propia en /admin/comentarios, que sí admite MARKETING — así el
// equipo de marketing gestiona sus respuestas sin volverse ADMIN (ADMIN es
// comodín: ve comisiones, contactos y API keys).
//
// OJO: esto sigue siendo permiso POR ROL, y MARKETING no es una sola persona
// (p.ej. la cuenta de pantalla pantallapdc@). Cuando exista el moderador de
// permisos por usuario, este helper se reemplaza por can(session, "comentarios.gestionar").
export const COMMENT_RULES_ROLES = ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"] as const;

/** True si el rol puede leer y editar las reglas de comentarios. Fail-closed. */
export function canManageCommentRules(role: string | null | undefined): boolean {
  if (!role) return false;
  return (COMMENT_RULES_ROLES as readonly string[]).includes(role);
}

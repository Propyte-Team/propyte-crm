// ============================================================
// Control de acceso basado en roles (RBAC)
// ============================================================

// Jerarquía de roles (mayor índice = mayor nivel de acceso)
export const ROLE_HIERARCHY: Record<string, number> = {
  VIEWER: 0,
  SDR: 1,
  SALES_REP: 2,
  CLOSER: 3,
  MARKETING: 4,
  TEAM_LEAD: 5,
  MANAGER: 6,
  ADMIN: 7,
  SUPER_ADMIN: 8,
} as const;

// Acciones posibles sobre recursos
type Action = "create" | "read" | "update" | "delete" | "export" | "assign" | "transfer";

// Recursos protegidos del sistema
type Resource =
  | "contacts"
  | "deals"
  | "activities"
  | "reports"
  | "users"
  | "settings"
  | "commissions"
  | "pipelines"
  | "teams"
  | "plazas"
  | "imports"
  | "marketing_campaigns";

// Tipo para una regla de permiso
interface PermissionRule {
  roles: string[];
  scope?: "own" | "team" | "plaza" | "all";
}

// Matriz de permisos: recurso → acción → regla
const PERMISSION_MATRIX: Record<string, Record<string, PermissionRule>> = {
  contacts: {
    create: { roles: ["SDR", "SALES_REP", "CLOSER", "TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN"] },
    read: { roles: ["SDR", "SALES_REP", "CLOSER", "TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN", "VIEWER", "MARKETING"] },
    update: { roles: ["SDR", "SALES_REP", "CLOSER", "TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN"] },
    delete: { roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"] },
    export: { roles: ["TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN"] },
    assign: { roles: ["TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN"] },
    transfer: { roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"] },
  },
  deals: {
    create: { roles: ["SALES_REP", "CLOSER", "TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN"] },
    read: { roles: ["SDR", "SALES_REP", "CLOSER", "TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN", "VIEWER", "MARKETING"] },
    update: { roles: ["SALES_REP", "CLOSER", "TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN"] },
    delete: { roles: ["ADMIN", "SUPER_ADMIN"] },
    export: { roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"] },
    assign: { roles: ["TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN"] },
    transfer: { roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"] },
  },
  activities: {
    create: { roles: ["SDR", "SALES_REP", "CLOSER", "TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN"] },
    read: { roles: ["SDR", "SALES_REP", "CLOSER", "TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN", "VIEWER"] },
    update: { roles: ["SDR", "SALES_REP", "CLOSER", "TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN"] },
    delete: { roles: ["TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN"] },
  },
  reports: {
    read: { roles: ["TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN", "MARKETING"] },
    export: { roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"] },
  },
  users: {
    create: { roles: ["ADMIN", "SUPER_ADMIN"] },
    read: { roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"] },
    update: { roles: ["ADMIN", "SUPER_ADMIN"] },
    delete: { roles: ["SUPER_ADMIN"] },
  },
  settings: {
    read: { roles: ["ADMIN", "SUPER_ADMIN"] },
    update: { roles: ["SUPER_ADMIN"] },
  },
  commissions: {
    read: { roles: ["SALES_REP", "CLOSER", "TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN"] },
    update: { roles: ["ADMIN", "SUPER_ADMIN"] },
    export: { roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"] },
  },
  pipelines: {
    read: { roles: ["SALES_REP", "CLOSER", "TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN", "VIEWER"] },
    update: { roles: ["ADMIN", "SUPER_ADMIN"] },
  },
  teams: {
    create: { roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"] },
    read: { roles: ["TEAM_LEAD", "MANAGER", "ADMIN", "SUPER_ADMIN"] },
    update: { roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"] },
    delete: { roles: ["ADMIN", "SUPER_ADMIN"] },
  },
  plazas: {
    create: { roles: ["ADMIN", "SUPER_ADMIN"] },
    read: { roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"] },
    update: { roles: ["ADMIN", "SUPER_ADMIN"] },
    delete: { roles: ["SUPER_ADMIN"] },
  },
  imports: {
    create: { roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"] },
    read: { roles: ["MANAGER", "ADMIN", "SUPER_ADMIN"] },
  },
  marketing_campaigns: {
    create: { roles: ["MARKETING", "ADMIN", "SUPER_ADMIN"] },
    read: { roles: ["MARKETING", "MANAGER", "ADMIN", "SUPER_ADMIN"] },
    update: { roles: ["MARKETING", "ADMIN", "SUPER_ADMIN"] },
    delete: { roles: ["ADMIN", "SUPER_ADMIN"] },
  },
};

/**
 * Verifica si un rol tiene permiso para ejecutar una acción sobre un recurso.
 * @param userRole - Rol del usuario actual
 * @param resource - Recurso al que se quiere acceder
 * @param action - Acción a realizar
 * @returns true si el acceso está permitido
 */
export function canAccessResource(
  userRole: string,
  resource: Resource,
  action: Action
): boolean {
  const resourcePerms = PERMISSION_MATRIX[resource];
  if (!resourcePerms) return false;

  const rule = resourcePerms[action];
  if (!rule) return false;

  return rule.roles.includes(userRole);
}

/**
 * Verifica si un rol tiene al menos el nivel mínimo requerido.
 * @param userRole - Rol del usuario actual
 * @param minimumRole - Rol mínimo necesario
 * @returns true si el rol del usuario es igual o superior
 */
export function hasMinimumRole(userRole: string, minimumRole: string): boolean {
  const userLevel = ROLE_HIERARCHY[userRole];
  const requiredLevel = ROLE_HIERARCHY[minimumRole];

  if (userLevel === undefined || requiredLevel === undefined) return false;

  return userLevel >= requiredLevel;
}

/**
 * Determina el alcance de acceso a datos según el rol.
 * @param userRole - Rol del usuario
 * @returns Alcance: "own", "team", "plaza" o "all"
 */
export function getDataScope(userRole: string): "own" | "team" | "plaza" | "all" {
  switch (userRole) {
    case "SUPER_ADMIN":
    case "ADMIN":
      return "all";
    case "MANAGER":
      return "plaza";
    case "TEAM_LEAD":
      return "team";
    default:
      return "own";
  }
}

/**
 * Filtra una lista de elementos según el acceso del usuario.
 * Requiere que cada elemento tenga ownerId, teamId y plazaId.
 * @param items - Lista de elementos a filtrar
 * @param userRole - Rol del usuario
 * @param userId - ID del usuario
 * @param userTeamId - ID del equipo del usuario (opcional)
 * @param userPlazaId - ID de la plaza del usuario (opcional)
 * @returns Lista filtrada según permisos
 */
export function filterByAccess<
  T extends { ownerId: string; teamId?: string | null; plazaId?: string | null }
>(
  items: T[],
  userRole: string,
  userId: string,
  userTeamId?: string | null,
  userPlazaId?: string | null
): T[] {
  const scope = getDataScope(userRole);

  switch (scope) {
    case "all":
      return items;
    case "plaza":
      return items.filter((item) => item.plazaId === userPlazaId);
    case "team":
      return items.filter(
        (item) => item.teamId === userTeamId || item.ownerId === userId
      );
    case "own":
      return items.filter((item) => item.ownerId === userId);
    default:
      return [];
  }
}

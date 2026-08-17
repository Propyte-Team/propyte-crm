// La decisión de permiso — módulo PURO: sin Prisma, sin sesión, sin caché.
// Separado de can.ts para poder probar la tabla de verdad completa sin
// mockear la base, igual que hace src/lib/rbac/query-scope.ts.
import { isPermission } from "./catalog";

export type PermissionSource = "admin-comodin" | "override" | "rol" | "denegado";

export interface PermissionDecision {
  allowed: boolean;
  /** De dónde sale la decisión. La vista de Persona del moderador lo muestra. */
  source: PermissionSource;
}

export interface ResolveInput {
  role: string | null | undefined;
  permission: string;
  /** Permisos sembrados para ese rol. */
  rolePermissions: readonly string[];
  /** Excepción para esa persona, si existe. */
  override?: { granted: boolean } | null;
}

const DENEGADO: PermissionDecision = { allowed: false, source: "denegado" };

/**
 * Orden de precedencia, de mayor a menor:
 *   1. ADMIN → true sin consultar nada (seguro anti-apagón: ninguna
 *      combinación de checkboxes puede dejar la casa sin llave).
 *   2. Override de la persona → su `granted`, en ambos sentidos.
 *   3. Default del rol.
 *   4. Nada → false.
 */
export function resolvePermission(input: ResolveInput): PermissionDecision {
  const { role, permission, rolePermissions, override } = input;

  if (role === "ADMIN") return { allowed: true, source: "admin-comodin" };

  // Una clave fuera del catálogo no se concede por ninguna vía. Protege
  // contra filas viejas en base después de renombrar un permiso.
  if (!isPermission(permission)) return DENEGADO;

  if (!role) return DENEGADO;

  if (override) return { allowed: override.granted, source: "override" };

  if (rolePermissions.includes(permission)) return { allowed: true, source: "rol" };

  return DENEGADO;
}

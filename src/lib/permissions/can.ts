// can(): la puerta de entrada al moderador de permisos.
//
// Los permisos se leen de la BASE en cada petición, nunca del JWT. En el token
// de NextAuth, quitarle un permiso a alguien no surtiría efecto hasta que
// cerrara sesión: moverías un checkbox, no pasaría nada, y pensarías que el
// moderador está roto. El costo es una consulta extra, mitigada con el caché
// de abajo. Ver spec §5.1.
import prisma from "@/lib/db";
import type { Permission } from "./catalog";
import { resolvePermission, type PermissionDecision } from "./resolve";

const TTL_MS = 30_000;

interface CacheEntry {
  decision: PermissionDecision;
  expiresAt: number;
}

/** Caché por proceso. Con varios procesos, cada uno converge en un TTL. */
const cache = new Map<string, CacheEntry>();

const DENEGADO: PermissionDecision = { allowed: false, source: "denegado" };

export function invalidatePermissionCache(userId?: string): void {
  if (!userId) {
    cache.clear();
    return;
  }
  const prefijo = `${userId}|`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefijo)) cache.delete(key);
  }
}

export interface PermissionUser {
  id: string;
  role: string;
}

/** Igual que can(), pero devuelve también de dónde sale la decisión. */
export async function explain(
  user: PermissionUser | null | undefined,
  permission: Permission,
): Promise<PermissionDecision> {
  if (!user) return DENEGADO;

  // Antes del caché y de la base: ninguna combinación de checkboxes ni una
  // base caída puede dejar a un ADMIN fuera de su propio CRM.
  if (user.role === "ADMIN") return { allowed: true, source: "admin-comodin" };

  const key = `${user.id}|${permission}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.decision;

  let decision: PermissionDecision;
  try {
    const [rolePermissions, override] = await Promise.all([
      prisma.rolePermission.findMany({
        where: { role: user.role as never },
        select: { permission: true },
      }),
      prisma.userPermissionOverride.findUnique({
        where: { userId_permission: { userId: user.id, permission } },
        select: { granted: true },
      }),
    ]);

    decision = resolvePermission({
      role: user.role,
      permission,
      rolePermissions: rolePermissions.map((r) => r.permission),
      override,
    });
  } catch (error) {
    // Fail-closed, y SIN cachear: un corte momentáneo no debe dejar a nadie
    // bloqueado 30 segundos más de lo necesario.
    console.error("[permisos] fallo al resolver, denegando:", error);
    return DENEGADO;
  }

  cache.set(key, { decision, expiresAt: Date.now() + TTL_MS });
  return decision;
}

/** ¿Puede esta persona hacer esto? Fail-closed ante cualquier duda. */
export async function can(
  user: PermissionUser | null | undefined,
  permission: Permission,
): Promise<boolean> {
  return (await explain(user, permission)).allowed;
}

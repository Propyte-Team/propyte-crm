// Catálogo de campos CORE (columnas Prisma) y resolución de permisos por rol.
// Sirve al panel admin de visibilidad y al enforcement en API/server.
// Default (sin fila en core_field_permissions) = EDIT, para no romper el flujo actual.
import prisma from "@/lib/db";

export type FieldAccess = "HIDDEN" | "READ" | "EDIT";

// #934: el catálogo vive en core-fields-catalogo.ts (sin Prisma); se reexporta tal cual.
export { CORE_FIELDS, coreFieldKeys, type CoreFieldDef } from "./core-fields-catalogo";
import { coreFieldKeys } from "./core-fields-catalogo";

/**
 * Mapa fieldKey → access para un objeto y rol. Solo incluye overrides;
 * los campos ausentes se asumen EDIT (default no restrictivo).
 */
export async function resolveCoreFieldAccess(
  object: string,
  role: string
): Promise<Record<string, FieldAccess>> {
  try {
    const rows = await prisma.coreFieldPermission.findMany({
      where: { object, role: role as never },
      select: { fieldKey: true, access: true },
    });
    const map: Record<string, FieldAccess> = {};
    for (const r of rows) map[r.fieldKey] = r.access as FieldAccess;
    return map;
  } catch {
    // La tabla puede no existir aún (migración aditiva pendiente) → sin restricciones.
    return {};
  }
}

export function accessOf(map: Record<string, FieldAccess>, key: string): FieldAccess {
  return map[key] ?? "EDIT";
}

/** Devuelve una copia del registro sin los campos HIDDEN para el rol dado. */
export function stripHiddenCoreFields<T extends Record<string, unknown>>(
  object: string,
  accessMap: Record<string, FieldAccess>,
  record: T
): T {
  const clone: Record<string, unknown> = { ...record };
  for (const key of coreFieldKeys(object)) {
    if (accessMap[key] === "HIDDEN") delete clone[key];
  }
  return clone as T;
}

/** Lista de claves que el rol NO puede editar (HIDDEN o READ). Para bloquear en PUT. */
export function nonEditableKeys(
  object: string,
  accessMap: Record<string, FieldAccess>
): Set<string> {
  const out = new Set<string>();
  for (const key of coreFieldKeys(object)) {
    const a = accessMap[key] ?? "EDIT";
    if (a !== "EDIT") out.add(key);
  }
  return out;
}

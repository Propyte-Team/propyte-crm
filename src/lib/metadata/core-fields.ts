// Catálogo de campos CORE (columnas Prisma) y resolución de permisos por rol.
// Sirve al panel admin de visibilidad y al enforcement en API/server.
// Default (sin fila en core_field_permissions) = EDIT, para no romper el flujo actual.
import prisma from "@/lib/db";

export type FieldAccess = "HIDDEN" | "READ" | "EDIT";

export interface CoreFieldDef {
  key: string;
  label: string;
  group: string;
}

// Campos editables/visibles del módulo Contacto (orden = grupos del detalle).
export const CORE_FIELDS: Record<string, CoreFieldDef[]> = {
  contact: [
    { key: "firstName", label: "Nombre", group: "Datos" },
    { key: "lastName", label: "Apellido", group: "Datos" },
    { key: "phone", label: "Teléfono", group: "Datos" },
    { key: "secondaryPhone", label: "Teléfono 2", group: "Datos" },
    { key: "email", label: "Email", group: "Datos" },
    { key: "preferredLanguage", label: "Idioma", group: "Datos" },
    { key: "residenceCity", label: "Ciudad", group: "Ubicación" },
    { key: "residenceCountry", label: "País", group: "Ubicación" },
    { key: "nationality", label: "Nacionalidad", group: "Ubicación" },
    { key: "investmentProfile", label: "Perfil de inversión", group: "Perfil de inversión" },
    { key: "propertyType", label: "Tipo de propiedad", group: "Perfil de inversión" },
    { key: "purchaseTimeline", label: "Horizonte de compra", group: "Perfil de inversión" },
    { key: "budgetMin", label: "Presupuesto mín.", group: "Perfil de inversión" },
    { key: "budgetMax", label: "Presupuesto máx.", group: "Perfil de inversión" },
    { key: "paymentMethod", label: "Forma de pago", group: "Perfil de inversión" },
    { key: "preferredZone", label: "Zona preferida", group: "Perfil de inversión" },
    { key: "purchaseModality", label: "Modalidad de compra", group: "Perfil de inversión" },
    { key: "rentalStrategy", label: "Estrategia de renta", group: "Perfil de inversión" },
    { key: "contactStatus", label: "Estado del contacto", group: "Clasificación" },
    { key: "temperature", label: "Temperatura", group: "Clasificación" },
    { key: "contactType", label: "Tipo de contacto", group: "Clasificación" },
    { key: "urgency", label: "Urgencia", group: "Clasificación" },
    { key: "score", label: "Score", group: "Clasificación" },
    // AUD-20260710-04: fuente editable inline en el detalle — gateable por rol desde aquí
    { key: "leadSource", label: "Fuente del lead", group: "Clasificación" },
  ],
};

export function coreFieldKeys(object: string): Set<string> {
  return new Set((CORE_FIELDS[object] ?? []).map((f) => f.key));
}

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

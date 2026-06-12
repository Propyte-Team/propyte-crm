// Registro de metadata — UNA fuente de definición (PC7) con cache en memoria (TTL 60s).
// buildZodFromRegistry genera el validador runtime de los valores `custom` JSONB.
import prisma from "@/lib/db";
import { z } from "zod";
import type { CustomFieldDef, FieldOption, FieldPermission, UserRole } from "@prisma/client";

export type FieldWithMeta = CustomFieldDef & {
  options: FieldOption[];
  permissions: FieldPermission[];
};

const cache = new Map<string, { at: number; fields: FieldWithMeta[] }>();
const TTL_MS = 60_000;

export function invalidateMetadataCache(objectApiName?: string): void {
  if (objectApiName) cache.delete(objectApiName);
  else cache.clear();
}

export async function getActiveFields(objectApiName: string): Promise<FieldWithMeta[]> {
  const hit = cache.get(objectApiName);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.fields;

  const fields = await prisma.customFieldDef.findMany({
    where: { objectApiName, isActive: true, archivedAt: null, isSystem: false },
    orderBy: { order: "asc" },
    include: { options: { where: { isActive: true }, orderBy: { order: "asc" } }, permissions: true },
  });
  cache.set(objectApiName, { at: Date.now(), fields });
  return fields;
}

// Field-level security (PC5): sin permiso explícito para el rol → READ por default
// para roles internos; HIDDEN nunca llega al cliente.
export function visibleFields(fields: FieldWithMeta[], role: UserRole): { field: FieldWithMeta; canEdit: boolean }[] {
  const result: { field: FieldWithMeta; canEdit: boolean }[] = [];
  for (const field of fields) {
    const perm = field.permissions.find((p) => p.role === role);
    const access = perm?.access ?? (role === "ADMIN" ? "EDIT" : "READ");
    if (access === "HIDDEN") continue;
    result.push({ field, canEdit: access === "EDIT" || role === "ADMIN" });
  }
  return result;
}

function zodForField(field: FieldWithMeta): z.ZodTypeAny {
  const v = (field.validation ?? {}) as { min?: number; max?: number; pattern?: string };
  let schema: z.ZodTypeAny;

  switch (field.fieldType) {
    case "NUMBER":
    case "CURRENCY":
    case "PERCENT": {
      let n = z.number();
      if (typeof v.min === "number") n = n.min(v.min);
      if (typeof v.max === "number") n = n.max(v.max);
      schema = n;
      break;
    }
    case "BOOLEAN":
      schema = z.boolean();
      break;
    case "DATE":
    case "DATETIME":
      schema = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Fecha inválida");
      break;
    case "EMAIL":
      schema = z.string().email();
      break;
    case "URL":
      schema = z.string().url();
      break;
    case "PHONE":
      schema = z.string().min(10).max(20);
      break;
    case "PICKLIST":
      schema = field.options.length
        ? z.enum(field.options.map((o) => o.value) as [string, ...string[]])
        : z.string();
      break;
    case "MULTI_PICKLIST":
      schema = field.options.length
        ? z.array(z.enum(field.options.map((o) => o.value) as [string, ...string[]]))
        : z.array(z.string());
      break;
    case "USER":
    case "LOOKUP":
      schema = z.string().uuid();
      break;
    case "TEXTAREA": {
      let t = z.string().max(typeof v.max === "number" ? v.max : 5000);
      if (typeof v.min === "number") t = t.min(v.min);
      schema = t;
      break;
    }
    default: {
      let t = z.string().max(typeof v.max === "number" ? v.max : 500);
      if (typeof v.min === "number") t = t.min(v.min);
      if (v.pattern) t = t.regex(new RegExp(v.pattern));
      schema = t;
    }
  }
  return field.isRequired ? schema : schema.optional().nullable();
}

// Valida un objeto de valores custom contra el registro. strict: rechaza claves no registradas.
export function buildZodFromRegistry(fields: FieldWithMeta[]): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) shape[field.apiName] = zodForField(field);
  return z.object(shape).partial().strict();
}

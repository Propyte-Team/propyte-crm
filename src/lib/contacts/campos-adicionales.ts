// #914 — «Información adicional» del contacto: la ÚNICA lista de estos campos.
//
// Nacieron para la migración de los leads de Zoho (datos que Zoho tenía y el CRM no), pero son
// columnas normales de `contacts`. De esta lista salen, sin copias a mano:
//   - la validación de /api/contacts (alta y edición)      → CAMPOS_ADICIONALES_SHAPE
//   - lo que se escribe en la base al crear/editar         → datosCamposAdicionales
//   - el catálogo de permisos por rol                      → core-fields.ts
//   - la sección de la ficha y las etiquetas del historial → info-adicional.tsx / timeline
// Es la lección de la familia «regla duplicada» (#730, #682, #907…): una lista copiada en
// cinco sitios termina diciendo cinco cosas distintas.
//
// Lógica pura: sin Prisma ni React, para que la importen tanto el servidor como el cliente.
import { z } from "zod";

export type TipoCampoAdicional = "texto" | "email" | "largo" | "booleano";

export interface CampoAdicional {
  /** Nombre de la columna en `contacts` (y clave en el body de /api/contacts). */
  key: string;
  label: string;
  tipo: TipoCampoAdicional;
  /** Largo máximo para los de texto. */
  max?: number;
}

export const CAMPOS_ADICIONALES = [
  { key: "company", label: "Empresa / inmobiliaria", tipo: "texto", max: 200 },
  { key: "secondaryEmail", label: "Email 2", tipo: "email", max: 200 },
  { key: "facebook", label: "Facebook", tipo: "texto", max: 200 },
  { key: "instagramHandle", label: "Instagram", tipo: "texto", max: 100 },
  { key: "budgetText", label: "Presupuesto declarado", tipo: "texto", max: 200 },
  { key: "brokerInterest", label: "Interés del broker", tipo: "largo", max: 5000 },
  { key: "initialMessage", label: "Mensaje inicial", tipo: "largo", max: 5000 },
  { key: "internalStage", label: "Etapa interna", tipo: "texto", max: 100 },
  { key: "discardReason", label: "Razón de descarte", tipo: "texto", max: 200 },
  { key: "appliedPosition", label: "Puesto solicitado", tipo: "texto", max: 100 },
  { key: "inSequence", label: "En secuencia (Zoho)", tipo: "booleano" },
] as const satisfies readonly CampoAdicional[];

export type ClaveCampoAdicional = (typeof CAMPOS_ADICIONALES)[number]["key"];

export const CLAVES_CAMPOS_ADICIONALES: readonly ClaveCampoAdicional[] = CAMPOS_ADICIONALES.map((c) => c.key);

/** Grupo con el que aparecen en el panel de permisos por campo (core-fields.ts). */
export const GRUPO_CAMPOS_ADICIONALES = "Información adicional";

function esquemaDe(c: CampoAdicional): z.ZodTypeAny {
  switch (c.tipo) {
    case "booleano":
      // null = «sin dato» (no es lo mismo que «no»).
      return z.boolean().nullable().optional();
    case "email":
      // "" = borrar, igual que el email principal.
      return z.string().trim().toLowerCase().email("Email inválido").max(c.max ?? 200).optional().nullable().or(z.literal(""));
    default:
      return z.string().max(c.max ?? 200).optional().nullable();
  }
}

/** Forma zod para mezclar con el esquema de /api/contacts: `z.object({...base, ...SHAPE})`. */
export const CAMPOS_ADICIONALES_SHAPE = Object.fromEntries(
  CAMPOS_ADICIONALES.map((c) => [c.key, esquemaDe(c)]),
) as Record<ClaveCampoAdicional, z.ZodTypeAny>;

/**
 * Lo que se escribe en la base para estos campos. Solo incluye las claves que vinieron en el
 * body (`undefined` = no tocar), y vacío/espacios → null: en la base «sin dato» es NULL, nunca "".
 */
/** Tipo exacto por columna (texto → string, booleano → boolean), para que Prisma lo acepte. */
export type DatosCamposAdicionales = {
  [C in (typeof CAMPOS_ADICIONALES)[number] as C["key"]]?: C["tipo"] extends "booleano"
    ? boolean | null
    : string | null;
};

export function datosCamposAdicionales(data: Partial<Record<string, unknown>>): DatosCamposAdicionales {
  const out: Record<string, string | boolean | null> = {};
  for (const c of CAMPOS_ADICIONALES as readonly CampoAdicional[]) {
    const v = data[c.key];
    if (v === undefined) continue;
    if (c.tipo === "booleano") {
      out[c.key] = typeof v === "boolean" ? v : null;
      continue;
    }
    const s = typeof v === "string" ? v.trim() : "";
    out[c.key] = s === "" ? null : s;
  }
  return out as DatosCamposAdicionales;
}

/** Etiqueta para el historial de cambios («Empresa / inmobiliaria se actualizó de … a …»). */
export const ETIQUETAS_CAMPOS_ADICIONALES: Record<string, string> = Object.fromEntries(
  CAMPOS_ADICIONALES.map((c) => [c.key, c.label]),
);

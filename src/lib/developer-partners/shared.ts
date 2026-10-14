// Desarrolladores (#872) — reglas compartidas entre servidor y pantalla. Módulo PURO: sin
// Prisma, sin sesión, sin React, para probarlo en node y poder importarlo desde el cliente.
import { z } from "zod";

/**
 * Quién da de alta y corrige desarrolladores. Todos los demás roles solo consultan.
 * DIRECTOR entra porque configura desarrollos y propiedades (definido 2026-10-14, #869).
 * Fail-closed: un rol ausente o desconocido no escribe.
 */
export const DESARROLLADORES_ESCRITURA = ["ADMIN", "DIRECTOR"] as const;

export function puedeEditarDesarrolladores(role: string | null | undefined): boolean {
  return !!role && (DESARROLLADORES_ESCRITURA as readonly string[]).includes(role);
}

/** Lo que se pinta cuando un dato no se capturó (mismo criterio que la tabla de Contactos). */
export const CELDA_VACIA = "-";

/** Texto de una celda: el valor, o «-» si viene vacío, nulo o solo con espacios. */
export function celda(valor: string | null | undefined): string {
  const v = valor?.trim();
  return v ? v : CELDA_VACIA;
}

/**
 * Enlace del sitio web. Se captura como lo escriba la persona («nativa.mx», «www…», «https://…»);
 * aquí solo se le antepone https:// para que el enlace abra. Devuelve null si no hay sitio o si
 * el esquema no es http(s) — un `javascript:` capturado no debe volverse enlace.
 */
export function hrefSitio(website: string | null | undefined): string | null {
  const v = website?.trim();
  if (!v) return null;
  const conEsquema = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const url = new URL(conEsquema);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// --------------- validación ---------------

/** Cadena opcional: recorta, y vacía → null (así la celda muestra «-» y no un hueco). */
const opcional = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const t = v?.trim() ?? "";
      return t === "" ? null : t;
    })
    .refine((v) => v == null || v.length <= max, `Máximo ${max} caracteres`);

const campos = {
  name: z.string({ required_error: "El nombre es obligatorio" }).trim().min(1, "El nombre es obligatorio").max(200),
  website: opcional(300).refine((v) => v == null || hrefSitio(v) !== null, "Sitio web no válido"),
  email: opcional(254).refine(
    (v) => v == null || z.string().email().safeParse(v).success,
    "Email no válido"
  ),
  phone: opcional(40),
};

export const desarrolladorCrearSchema = z.object(campos).strict();

export const desarrolladorEditarSchema = z
  .object({ ...campos, name: campos.name.optional() })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), "No hay cambios");

export type DesarrolladorFila = {
  id: string;
  name: string;
  website: string | null;
  email: string | null;
  phone: string | null;
};

/** P2021 = la tabla no existe (código desplegado antes que la migración). */
export function esTablaFaltante(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2021";
}

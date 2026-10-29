// Empresas (antes «Desarrolladores», #872 → #949) — reglas compartidas entre servidor y pantalla.
// Módulo PURO: sin Prisma, sin sesión, sin React, para probarlo en node y poder importarlo desde
// el cliente. El modelo y la tabla siguen llamándose DeveloperPartner / developer_partners:
// renombrarlos no aporta nada y costaría una migración destructiva.
import { z } from "zod";
import { siFalta } from "@/lib/validations/zod4";

/**
 * Quién da de alta, corrige y crea empresas. Todos los demás roles solo consultan.
 * DIRECTOR entra porque configura desarrollos y propiedades (definido 2026-10-14, #869).
 * GERENTE entra por decisión de sistemas@ del 2026-10-29 (#949).
 * Fail-closed: un rol ausente o desconocido no escribe.
 */
export const DESARROLLADORES_ESCRITURA = ["ADMIN", "DIRECTOR", "GERENTE"] as const;

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

// --------------- tipo de empresa (#949) ---------------

/**
 * Tipos de empresa. Para agregar uno basta una línea aquí: la columna es texto (no enum de
 * Postgres), así que no hace falta migración. El orden es el del filtro y del selector.
 */
export const TIPOS_EMPRESA = [
  { value: "DESARROLLADORA", label: "Desarrolladora" },
  { value: "INMOBILIARIA", label: "Inmobiliaria" },
  { value: "PROVEEDOR", label: "Proveedor" },
] as const;

export type TipoEmpresa = (typeof TIPOS_EMPRESA)[number]["value"];

const VALORES_TIPO = TIPOS_EMPRESA.map((t) => t.value) as [TipoEmpresa, ...TipoEmpresa[]];

/** Valor del filtro para las empresas sin tipo (no debería haber: el alta lo exige). */
export const TIPO_EMPRESA_SIN_TIPO = "SIN_TIPO";

export function esTipoEmpresa(v: unknown): v is TipoEmpresa {
  return typeof v === "string" && (VALORES_TIPO as readonly string[]).includes(v);
}

/** Etiqueta del tipo. Un valor que ya no está en la lista se muestra tal cual, no se esconde. */
export function etiquetaTipoEmpresa(v: string | null | undefined): string {
  if (!v) return "Sin tipo";
  return TIPOS_EMPRESA.find((t) => t.value === v)?.label ?? v;
}

/**
 * `?tipo=` de la lista → condición sobre `type`. Un valor desconocido se ignora (lista completa),
 * como el filtro de flujo (#951). «SIN_TIPO» busca las que no tienen tipo.
 */
export function whereTipoEmpresa(param: string | null | undefined): { type: string | null } | null {
  if (!param) return null;
  if (param === TIPO_EMPRESA_SIN_TIPO) return { type: null };
  return esTipoEmpresa(param) ? { type: param } : null;
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
  name: z.string(siFalta("El nombre es obligatorio")).trim().min(1, "El nombre es obligatorio").max(200),
  type: z.enum(VALORES_TIPO, { error: "Elige el tipo de empresa" }),
  website: opcional(300).refine((v) => v == null || hrefSitio(v) !== null, "Sitio web no válido"),
  email: opcional(254).refine(
    (v) => v == null || z.string().email().safeParse(v).success,
    "Email no válido"
  ),
  phone: opcional(40),
};

export const desarrolladorCrearSchema = z.object(campos).strict();

export const desarrolladorEditarSchema = z
  .object({ ...campos, name: campos.name.optional(), type: campos.type.optional() })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), "No hay cambios");

/** Asignar o quitar un contacto de una empresa desde el cuadro de la empresa. */
export const contactoDeEmpresaSchema = z.object({ contactId: z.string().trim().min(1) }).strict();

export type DesarrolladorFila = {
  id: string;
  name: string;
  type: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
};

/** Lo que el selector de empresa de la ficha del contacto necesita. */
export type EmpresaOpcion = Pick<DesarrolladorFila, "id" | "name" | "type">;

/**
 * Un contacto en el cuadro de la empresa. Todos los roles ven a todos los contactos de la empresa
 * (decisión de sistemas@, #949), pero teléfono y email solo salen si quien mira puede abrir su
 * ficha; si no, el nombre va sin liga.
 */
export type ContactoDeEmpresa = {
  id: string;
  nombre: string;
  contactType: string | null;
  asesor: string | null;
  /** Pasa las mismas dos puertas que abrir la ficha (rol + marca). */
  puedeAbrir: boolean;
  email: string | null;
  phone: string | null;
};

// --------------- selector de empresa (#949) ---------------

/** Para comparar nombres sin importar mayúsculas ni acentos («Ekasa» = «ekása»). */
export function normalizarNombre(v: string): string {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

/** Las empresas cuyo nombre contiene lo escrito (todas si no se escribió nada). */
export function filtrarEmpresas<T extends { name: string }>(lista: readonly T[], texto: string): T[] {
  const q = normalizarNombre(texto);
  if (!q) return [...lista];
  return lista.filter((e) => normalizarNombre(e.name).includes(q));
}

/**
 * ¿Se ofrece «Crear empresa “…”»? Solo a quien puede crear, con algo escrito, y si no existe ya
 * una empresa con ese mismo nombre (así no se duplica Ekasa por escribirla en minúsculas).
 */
export function ofrecerCrearEmpresa(lista: readonly { name: string }[], texto: string, puedeCrear: boolean): boolean {
  const q = normalizarNombre(texto);
  if (!puedeCrear || !q) return false;
  return !lista.some((e) => normalizarNombre(e.name) === q);
}

/**
 * Qué mandar de «Empresa» desde el formulario del contacto. Al crear, solo si se eligió una. Al
 * editar, solo si CAMBIÓ (incluido quitarla → null): así un rol que tiene el campo en solo lectura
 * puede seguir guardando lo demás (el servidor da 403 a un campo bloqueado aunque traiga el mismo
 * valor). Mismo patrón que `campoReferidoPor` (#907).
 */
export function campoEmpresa(
  mode: "create" | "edit",
  inicialId: string | null,
  actualId: string | null,
): { developerPartnerId?: string | null } {
  if (mode === "create") return actualId ? { developerPartnerId: actualId } : {};
  return actualId === inicialId ? {} : { developerPartnerId: actualId };
}

/** Dirección del módulo Empresas con el cuadro de una empresa ya abierto. */
export function hrefEmpresa(id: string): string {
  return `/empresas?empresa=${encodeURIComponent(id)}`;
}

/** P2021 = la tabla no existe (código desplegado antes que la migración). */
export function esTablaFaltante(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2021";
}

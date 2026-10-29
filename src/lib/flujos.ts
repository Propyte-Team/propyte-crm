// #948 — Flujo comercial (F1–F8) del contacto y del negocio: la ÚNICA lista de flujos.
//
// Sale del flujograma comercial (FLUJOGRAMA_PROPYTE v0.1, columnas E–L de la Hoja 1): cada flujo
// tiene sus responsables, subetapas y tiempos. Es la base del Copilot (#868).
//
// Dónde vive (decisión de sistemas@, 2026-10-29):
//   - contacts.flujo = el flujo con el que ENTRÓ el contacto (sirve de Nuevo a Reunión, cuando
//     aún no hay negocio, y para saber el responsable desde el inicio).
//   - deals.flujo    = el flujo de ESE negocio. Una persona puede tener dos negocios en flujos
//     distintos.
// Es opcional: NULL = «Sin flujo» y la ficha lo muestra para que el asesor lo elija.
//
// El llenado automático NO está aquí: lo hacen dos disparadores de Postgres
// (prisma/migrations-manual/2026-10-29-flujo.sql), porque contactos y negocios se escriben por
// muchos caminos (API, intake, bot, workflows, Zapier) y una regla copiada en cada uno termina
// diciendo cosas distintas (#730, #907). Los disparadores solo llenan cuando el campo está vacío:
//   - contacto Broker externo → F6, contacto Empleo → F8;
//   - negocio Nativa (contado o financiamiento) → F5; si no, el flujo del contacto.
//
// Lógica pura: sin Prisma ni React, para que la importen servidor y cliente.

/** Valores del enum `Flujo` de Prisma, en el orden del flujograma. Paridad: flujos.test.ts. */
export const FLUJO_ORDER = [
  "F1_CORRETAJE_VENDEDOR",
  "F2_CORRETAJE_COMPRADOR",
  "F3_CAPTACION_MB",
  "F4_MB",
  "F5_NATIVA",
  "F6_BROKER",
  "F7_INMOBILIARIA",
  "F8_EMPLEO",
] as const;

export type Flujo = (typeof FLUJO_ORDER)[number];

/** Etiqueta con el número del flujograma, para selectores, chips y la cronología. */
export const FLUJO_LABELS: Record<Flujo, string> = {
  F1_CORRETAJE_VENDEDOR: "F1 · Corretaje vendedor",
  F2_CORRETAJE_COMPRADOR: "F2 · Corretaje comprador",
  F3_CAPTACION_MB: "F3 · Captación MB",
  F4_MB: "F4 · MB",
  F5_NATIVA: "F5 · Nativa",
  F6_BROKER: "F6 · Broker",
  F7_INMOBILIARIA: "F7 · Inmobiliaria",
  F8_EMPLEO: "F8 · Empleo",
};

/** Lo que se muestra cuando el campo está vacío: es un aviso para que el asesor lo elija. */
export const FLUJO_VACIO_LABEL = "Sin flujo";

/** Opción vacía del formulario de negocio: el disparador pone Nativa o el flujo del contacto. */
export const FLUJO_AUTOMATICO_LABEL = "Automático (Nativa o el del contacto)";

export function etiquetaFlujo(valor: string | null | undefined): string {
  if (!valor) return FLUJO_VACIO_LABEL;
  return (FLUJO_LABELS as Record<string, string>)[valor] ?? valor;
}

/** Opciones para un select: «Sin flujo» primero (valor "") y luego los 8 flujos. */
export function opcionesFlujo(vacio: string = FLUJO_VACIO_LABEL): { value: string; label: string }[] {
  return [{ value: "", label: vacio }, ...FLUJO_ORDER.map((value) => ({ value, label: FLUJO_LABELS[value] }))];
}

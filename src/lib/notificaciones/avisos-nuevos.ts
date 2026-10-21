// Qué notificaciones son NUEVAS desde la última revisión de la campana (#889, #915). Puro.
//
// La campana pide las últimas no leídas cada 30 s. Para no repetir el aviso emergente de
// la misma notificación en cada revisión, se guarda la fecha de la más reciente ya vista
// (`vistoHasta`). En la PRIMERA revisión (al cargar la página) no se avisa de nada: lo que
// ya estaba sin leer se ve en el número de la campana, no en una ráfaga de avisos.

import { TIPO_AVISO_CORREO } from "@/lib/google/aviso-correo"
import { TIPOS_AVISO_ASIGNACION } from "./asignacion"

export const EVENTO_CORREO_ENTRANTE = "crm:correo-entrante"

export interface AvisoListado {
  id: string
  createdAt: string
}

export function avisosNuevos<T extends AvisoListado>(
  items: readonly T[],
  vistoHasta: string | null,
): { nuevos: T[]; vistoHasta: string } {
  const masReciente = items.reduce<string | null>(
    (max, n) => (max === null || Date.parse(n.createdAt) > Date.parse(max) ? n.createdAt : max),
    null,
  )

  if (vistoHasta === null) {
    // Primera revisión: marcar lo existente como visto. Sin nada, cualquier cosa posterior es nueva.
    return { nuevos: [], vistoHasta: masReciente ?? new Date(0).toISOString() }
  }

  const limite = Date.parse(vistoHasta)
  const nuevos = items
    .filter((n) => Date.parse(n.createdAt) > limite)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)) // del más viejo al más nuevo
  return { nuevos, vistoHasta: masReciente && Date.parse(masReciente) > limite ? masReciente : vistoHasta }
}

// ------------------------------------------------------------
// #915: la campana también avisa de las asignaciones, no solo de correos.
// ------------------------------------------------------------


/**
 * Los tipos que, además de sumar al número de la campana, salen como aviso en pantalla (y como
 * aviso del navegador si la pestaña está oculta). Antes solo el correo entrante (#889): una
 * conversación o una tarea asignada solo subía el número, y en producción hay 292 avisos en la
 * historia con 0 leídos.
 */
export const TIPOS_AVISO_EMERGENTE: readonly string[] = [TIPO_AVISO_CORREO, ...TIPOS_AVISO_ASIGNACION]

/** Lo que reporta `Notification.permission`, o `null` si el navegador no tiene la API. */
export type PermisoNavegador = "granted" | "denied" | "default" | null

/**
 * ¿Toca preguntar ahora? Con la pestaña visible, siempre. Oculta, solo si el navegador puede
 * mostrar el aviso: preguntar para no poder enseñarlo es gastar consultas.
 */
export function debeRevisar(pestanaOculta: boolean, permiso: PermisoNavegador): boolean {
  return !pestanaOculta || permiso === "granted"
}

/** ¿El aviso va al navegador (sistema operativo) en vez de, o además de, la pantalla? */
export function avisarEnNavegador(pestanaOculta: boolean, permiso: PermisoNavegador): boolean {
  return pestanaOculta && permiso === "granted"
}

/**
 * Al cargar la página no se lanza un aviso por cada pendiente (ver arriba), pero una asignación
 * sin ver no puede quedarse solo en el número: quien entra a las 9 a. m. tiene que enterarse de lo
 * que le asignaron anoche. Devuelve las asignaciones sin leer de la primera revisión, de la más
 * nueva a la más vieja, para UN aviso de resumen. El correo no entra: ese ya tiene su historial.
 */
export function asignacionesPendientesAlEntrar<T extends AvisoListado & { type: string }>(
  items: readonly T[],
): T[] {
  const asignacion = new Set<string>(TIPOS_AVISO_ASIGNACION)
  return items
    .filter((n) => asignacion.has(n.type))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

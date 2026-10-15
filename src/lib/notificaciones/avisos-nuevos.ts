// Qué notificaciones son NUEVAS desde la última revisión de la campana (#889). Puro.
//
// La campana pide las últimas no leídas cada 30 s. Para no repetir el aviso emergente de
// la misma notificación en cada revisión, se guarda la fecha de la más reciente ya vista
// (`vistoHasta`). En la PRIMERA revisión (al cargar la página) no se avisa de nada: lo que
// ya estaba sin leer se ve en el número de la campana, no en una ráfaga de avisos.

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

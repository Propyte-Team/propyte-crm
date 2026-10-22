// Filtro «Asesores» de la lista de Contactos (#919). Puro y sin Prisma: lo importa el
// componente del navegador.

/** Valor de `?assignedTo=` para los contactos sin dueño. */
export const SIN_ASIGNAR = "sin_asignar"

export interface OpcionAsesor {
  id: string
  name: string
  isActive?: boolean
  total: number
}

/** Minúsculas y sin acentos: «víctor» encuentra a «Victor Arroyo». */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
}

/** Los asesores cuyo nombre contiene TODAS las palabras escritas, en cualquier orden. */
export function filtrarAsesores<T extends { name: string }>(lista: readonly T[], texto: string): T[] {
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return [...lista]
  return lista.filter((a) => {
    const nombre = normalizar(a.name)
    return palabras.every((p) => nombre.includes(p))
  })
}

/**
 * ¿Vale la pena mostrar el filtro? Si quien mira solo puede ver los contactos de una persona
 * (un asesor ve los suyos) y no hay contactos sin dueño, filtrar no cambia nada.
 */
export function mostrarFiltroAsesores(asesores: readonly unknown[], sinAsignar: number): boolean {
  return asesores.length > 1 || (asesores.length >= 1 && sinAsignar > 0)
}

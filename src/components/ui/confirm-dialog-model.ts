// Modelo puro del diálogo de confirmación (sin React, para poder probarlo en node).
// Lo usa confirm-dialog.tsx; aquí viven los valores por defecto.

export interface ConfirmOptions {
  titulo: string
  descripcion?: string
  /** Texto del botón de confirmar. Default "Confirmar". */
  confirmar?: string
  /** Texto del botón de cancelar. Default "Cancelar". */
  cancelar?: string
  /** Si true, el botón de confirmar va en rojo (acciones destructivas). */
  peligroso?: boolean
}

export type ConfirmProps = Required<Omit<ConfirmOptions, "descripcion">> & { descripcion: string | undefined }

export function resolverOpciones(opts: ConfirmOptions): ConfirmProps {
  return {
    titulo: opts.titulo,
    descripcion: opts.descripcion,
    confirmar: opts.confirmar?.trim() || "Confirmar",
    cancelar: opts.cancelar?.trim() || "Cancelar",
    peligroso: opts.peligroso ?? false,
  }
}

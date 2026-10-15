// Qué hace el botón «Correo» de la ficha de contacto (#885). Puro y sin imports de servidor:
// lo usa el componente del cliente y se prueba sin navegador.

/** Lo que /api/email/estado devuelve y la decisión necesita (ver lib/email/providers). */
export interface EstadoCorreoCliente {
  conectado: boolean
  requiereReconexion: boolean
  nombreProveedor: string | null
  urlConectar: string
  disponibles?: { nombre: string }[]
}

export type DecisionCorreo =
  | { tipo: "abrir" }
  | { tipo: "aviso"; titulo: string; descripcion?: string; enlace?: { href: string; texto: string } }
  /** Faltan datos para decidir: hay que pedir el estado de la cuenta del asesor. */
  | { tipo: "consultar" }

export const AVISO_SIN_CORREO = "El correo no está registrado"

/**
 * Orden de las comprobaciones, de la más barata a la que necesita red:
 *   1. sin email en la ficha  → «El correo no está registrado» (texto pedido por sistemas@)
 *   2. «No contactar»         → no se abre el compositor (la ruta también lo rechaza)
 *   3. sin estado todavía     → consultar /api/email/estado
 *   4. cuenta vencida         → reconectar
 *   5. sin cuenta conectada   → conectar
 *   6. todo bien              → abrir el compositor
 */
export function decidirCorreo(input: {
  email: string | null | undefined
  doNotContact?: boolean | null
  estado?: EstadoCorreoCliente | null
}): DecisionCorreo {
  if (!input.email || !input.email.trim()) {
    return {
      tipo: "aviso",
      titulo: AVISO_SIN_CORREO,
      descripcion: "Agrega el email del contacto en Datos para poder escribirle.",
    }
  }
  if (input.doNotContact) {
    return { tipo: "aviso", titulo: "El contacto está marcado como No contactar" }
  }
  const estado = input.estado
  if (!estado) return { tipo: "consultar" }

  if (estado.conectado && estado.requiereReconexion) {
    const nombre = estado.nombreProveedor ?? "correo"
    return {
      tipo: "aviso",
      titulo: `Tu conexión con ${nombre} venció`,
      descripcion: "Vuelve a conectar tu cuenta para enviar correos desde el CRM.",
      enlace: { href: estado.urlConectar, texto: "Reconectar" },
    }
  }
  if (!estado.conectado) {
    const nombres = (estado.disponibles ?? []).map((d) => d.nombre)
    const cual = nombres.length > 0 ? nombres.join(" o ") : "tu cuenta de correo"
    return {
      tipo: "aviso",
      titulo: `Conecta tu ${cual} para enviar correos`,
      descripcion: "Los correos salen desde tu propia cuenta y quedan en el historial del contacto.",
      enlace: { href: estado.urlConectar, texto: "Ir a Mi Configuración" },
    }
  }
  return { tipo: "abrir" }
}

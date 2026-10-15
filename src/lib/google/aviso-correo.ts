// Aviso de correo entrante (#889). Puro, sin prisma: arma la notificación que recibe el
// asesor cuando un cliente le contesta, o decide que no hay que mandar ninguna.

export const TIPO_AVISO_CORREO = "email_inbound"

/** Más viejo que esto no avisa: se registra en el historial, pero no hace sonar la campana. */
export const VENTANA_AVISO_MS = 24 * 60 * 60 * 1000

export interface AvisoCorreo {
  userId: string
  title: string
  message: string
  type: typeof TIPO_AVISO_CORREO
  link: string
}

function recortar(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > max ? t.slice(0, max - 1) + "…" : t
}

/**
 * La notificación para el dueño del buzón, o `null` si no toca avisar.
 *
 * Por qué hay ventana: el registro de lo entrante va por delta (`history.list`), así que
 * en el día a día solo trae lo nuevo. Pero si la revisión estuvo parada y vuelve, o una
 * cuenta se reconecta, puede traer de golpe correos de días atrás. Esos se registran en
 * el historial igual; lo que no hacen es llenar la campana de avisos viejos.
 */
export function armarAvisoCorreo(input: {
  userId: string
  contacto: { id: string; firstName?: string | null; lastName?: string | null }
  fromEmail: string
  subject: string
  snippet: string
  fecha: Date
  ahora?: Date
}): AvisoCorreo | null {
  const ahora = input.ahora ?? new Date()
  if (ahora.getTime() - input.fecha.getTime() > VENTANA_AVISO_MS) return null

  const nombre = `${input.contacto.firstName ?? ""} ${input.contacto.lastName ?? ""}`.trim() || input.fromEmail
  const asunto = recortar(input.subject || "(sin asunto)", 80)
  const extracto = recortar(input.snippet || "", 120)

  return {
    userId: input.userId,
    title: `Correo de ${recortar(nombre, 60)}`,
    message: extracto ? `${asunto} — ${extracto}` : asunto,
    type: TIPO_AVISO_CORREO,
    link: `/contacts/${input.contacto.id}`,
  }
}

/** El id del contacto al que apunta un aviso (para refrescar su ficha si está abierta). */
export function contactoDelAviso(link: string | null | undefined): string | null {
  const m = link?.match(/^\/contacts\/([0-9a-f-]{36})(?:[/?#]|$)/i)
  return m ? m[1] : null
}

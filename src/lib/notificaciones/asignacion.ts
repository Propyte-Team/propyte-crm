// Aviso «Se te ha asignado…» (#915). Puro: sin Prisma ni sesión, para probar cada texto y cada
// motivo de NO avisar sin base de datos.
//
// POR QUÉ EXISTE. Cada sitio que cambiaba de dueño un contacto, un negocio o una tarea decidía por
// su cuenta si avisaba, y la mayoría no avisaba:
//   - PUT /api/contacts (la ficha) cambiaba `assignedToId` sin ninguna notificación;
//   - el alta de un contacto con asesor elegido, el cambio de asesor de un negocio y las tareas que
//     crean el workflow CREATE_TASK y la herramienta `create_task` del agente, tampoco;
//   - los dos que sí avisaban (la Bandeja y el reparto) tenían cada uno su texto.
// En producción, al 2026-10-20: 3 avisos de conversación asignada en 30 días y 4 tareas en total.
//
// La regla vive aquí UNA vez: a quién no se avisa, qué dice el aviso y a dónde lleva. El efecto
// (leer al asignado y escribir la fila) está en `avisar-asignacion.ts`.

import { formatDateTime } from "@/lib/format-date"
import { esCuentaTecnica } from "@/lib/workflows/ruteables"

export const TIPO_AVISO_TAREA = "task_assigned"
/** El mismo valor que ya usaba la Bandeja (`ASSIGN_NOTIFICATION_TYPE`): no cambia filas viejas. */
export const TIPO_AVISO_CONVERSACION = "conversation_assigned"
export const TIPO_AVISO_NEGOCIO = "deal_assigned"
/** El del reparto automático y del lote de huérfanos. Se lista para la campana; aquí no se arma. */
export const TIPO_AVISO_LEAD = "lead_assigned"

/** Los avisos de asignación, para la campana (aviso emergente y del navegador). */
export const TIPOS_AVISO_ASIGNACION = [
  TIPO_AVISO_TAREA,
  TIPO_AVISO_CONVERSACION,
  TIPO_AVISO_NEGOCIO,
  TIPO_AVISO_LEAD,
] as const

interface Comun {
  /** A quién se le asignó. `null` = se quitó la asignación: no hay a quién avisar. */
  asignadoId: string | null
  /** Quién asignó. `null` = el sistema (workflow, agente, integración). */
  actorId: string | null
  /** Para decir quién lo asignó. Sin nombre no se menciona. */
  actorNombre?: string | null
}

export type AvisoAsignacionInput =
  | (Comun & {
      tipo: "tarea"
      tareaId: string
      asunto: string
      vence?: Date | string | null
      contactoNombre?: string | null
    })
  | (Comun & {
      tipo: "conversacion"
      contactoId: string
      contactoNombre?: string | null
      /** Con hilo, el aviso abre la Bandeja en ese hilo; sin hilo, la ficha del contacto. */
      conversationId?: string | null
    })
  | (Comun & {
      tipo: "negocio"
      negocioId: string
      contactoNombre?: string | null
      desarrollo?: string | null
    })

export interface DestinoAviso {
  id: string
  email: string | null
  isActive: boolean
  deletedAt?: Date | string | null
}

export type MotivoSinAviso =
  | "sin_asignado"
  | "se_lo_asigno_a_si_mismo"
  | "usuario_no_existe"
  | "usuario_inactivo"
  | "cuenta_tecnica"

/**
 * Por qué NO se avisa, o `null` si sí. El orden importa solo para el motivo que se registra.
 *
 * Quien se asigna algo a sí mismo ya lo sabe. Una cuenta inactiva o técnica (`.local`) no la abre
 * nadie: en producción `agentes@propyte.local` acumula 91 avisos sin leer y una asesora dada de
 * baja, 12. Avisarles no le llega a nadie y además hace parecer atendido lo que no lo está.
 */
export function motivoSinAviso(
  input: Pick<Comun, "asignadoId" | "actorId">,
  destino: DestinoAviso | null,
): MotivoSinAviso | null {
  if (!input.asignadoId) return "sin_asignado"
  if (input.actorId && input.asignadoId === input.actorId) return "se_lo_asigno_a_si_mismo"
  if (!destino) return "usuario_no_existe"
  if (!destino.isActive || destino.deletedAt) return "usuario_inactivo"
  if (esCuentaTecnica(destino.email)) return "cuenta_tecnica"
  return null
}

export interface AvisoArmado {
  userId: string
  type: string
  title: string
  message: string
  link: string
}

/** `Notification.message` no tiene tope en la base, pero la campana muestra dos líneas. */
const TOPE_MENSAJE = 280

function recortar(texto: string): string {
  const limpio = texto.replace(/\s+/g, " ").trim()
  return limpio.length > TOPE_MENSAJE ? `${limpio.slice(0, TOPE_MENSAJE - 1)}…` : limpio
}

function porQuien(nombre: string | null | undefined, femenino: boolean): string {
  const n = nombre?.trim()
  if (!n) return ""
  return ` · Te ${femenino ? "la" : "lo"} asignó ${n}`
}

/** Arma la fila de `notifications`. Llamarla solo si `motivoSinAviso` devolvió `null`. */
export function armarAvisoAsignacion(input: AvisoAsignacionInput): AvisoArmado {
  const userId = input.asignadoId as string

  if (input.tipo === "tarea") {
    const vence = input.vence
      ? ` — vence ${formatDateTime(input.vence, { dateStyle: "medium", timeStyle: "short" })}`
      : ""
    const contacto = input.contactoNombre?.trim() ? ` · ${input.contactoNombre.trim()}` : ""
    return {
      userId,
      type: TIPO_AVISO_TAREA,
      title: "Se te ha asignado una tarea",
      message: recortar(`${input.asunto}${vence}${contacto}${porQuien(input.actorNombre, true)}`),
      link: "/agenda",
    }
  }

  if (input.tipo === "conversacion") {
    const contacto = input.contactoNombre?.trim() || "Un contacto"
    return {
      userId,
      type: TIPO_AVISO_CONVERSACION,
      title: "Se te ha asignado una conversación",
      message: recortar(`${contacto}${porQuien(input.actorNombre, true)}`),
      // `?c=` lo lee src/components/inbox/inbox-view.tsx para abrir ese hilo.
      link: input.conversationId ? `/inbox?c=${input.conversationId}` : `/contacts/${input.contactoId}`,
    }
  }

  const contacto = input.contactoNombre?.trim() || "Un contacto"
  const desarrollo = input.desarrollo?.trim() ? ` · ${input.desarrollo.trim()}` : ""
  return {
    userId,
    type: TIPO_AVISO_NEGOCIO,
    title: "Se te ha asignado un negocio",
    message: recortar(`${contacto}${desarrollo}${porQuien(input.actorNombre, false)}`),
    link: `/pipeline/${input.negocioId}`,
  }
}

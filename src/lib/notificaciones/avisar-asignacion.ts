// El efecto del aviso de asignación (#915): lee al asignado, decide con `motivoSinAviso` y
// escribe la fila. La regla y los textos viven en `asignacion.ts` (puro).
//
// NUNCA lanza. Avisar es un efecto secundario de una asignación que ya quedó escrita: si el aviso
// falla, la asignación se queda y el fallo se registra en el log (misma regla que la Bandeja,
// lección 2026-07-24). Devuelve qué pasó para que las pruebas y quien llame lo puedan leer.

import type { Prisma, PrismaClient } from "@prisma/client"
import prisma from "@/lib/db"
import {
  armarAvisoAsignacion,
  motivoSinAviso,
  type AvisoAsignacionInput,
  type MotivoSinAviso,
} from "./asignacion"

type Db = PrismaClient | Prisma.TransactionClient

export type ResultadoAviso =
  | { avisado: true; notificationId: string }
  | { avisado: false; motivo: MotivoSinAviso | "error" }

export async function avisarAsignacion(
  input: AvisoAsignacionInput,
  dbOpcional?: Db,
): Promise<ResultadoAviso> {
  try {
    // Dentro del try a propósito: hasta resolver el cliente de base de datos puede fallar (en
    // pruebas, un mock de `@/lib/db` sin `default`), y un aviso nunca tumba la asignación.
    const db = dbOpcional ?? prisma
    // Lo que se decide sin leer nada va primero: ahorra la consulta y es la mayoría de los casos
    // (quitar la asignación, o asignarse algo a uno mismo).
    const previo = motivoSinAviso(input, { id: "", email: null, isActive: true })
    if (previo === "sin_asignado" || previo === "se_lo_asigno_a_si_mismo") {
      return { avisado: false, motivo: previo }
    }

    const destino = await db.user.findUnique({
      where: { id: input.asignadoId as string },
      select: { id: true, email: true, isActive: true, deletedAt: true },
    })
    const motivo = motivoSinAviso(input, destino)
    if (motivo) {
      if (motivo !== "usuario_no_existe") {
        console.warn(`[aviso-asignacion] sin aviso a ${input.asignadoId}: ${motivo}`)
      }
      return { avisado: false, motivo }
    }

    // Una reasignación desde la ficha no sabe del hilo; si el contacto tiene uno, el aviso lleva
    // a la Bandeja en ese hilo, que es donde el asesor tiene que contestar.
    let datos = input
    if (input.tipo === "conversacion" && input.conversationId === undefined) {
      const hilo = await db.conversation.findFirst({
        where: { contactId: input.contactoId },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      })
      datos = { ...input, conversationId: hilo?.id ?? null }
    }

    const fila = await db.notification.create({ data: armarAvisoAsignacion(datos) })
    return { avisado: true, notificationId: fila.id }
  } catch (e) {
    console.error("[aviso-asignacion] no se pudo avisar al asignado", e)
    return { avisado: false, motivo: "error" }
  }
}

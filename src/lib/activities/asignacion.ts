// ============================================================
// Tareas: quién puede asignarle una tarea a quién (#915)
// ============================================================
// Hasta ahora una tarea siempre quedaba a nombre de quien la creaba: POST /api/activities y
// `createActivity` forzaban `userId = sesión`, así que nadie podía asignarle trabajo a un asesor.
//
// Regla que definió sistemas@ el 2026-10-20/21:
//
//      rol            puede asignar tareas a
//      ─────────────  ─────────────────────────────────────────────
//      ADMIN          cualquier asesor
//      DIRECTOR       cualquier asesor
//      GERENTE        los asesores de SU plaza
//      TEAM_LEADER    los asesores de su equipo (`teamLeaderId` = él)
//      cualquier otro solo a sí mismo
//
// «Asesor» = los roles que reciben leads (`ROLES_RUTEABLES`: ASESOR, ASESOR_SR, ASESOR_JR), y
// solo si es una persona atendible: activa, no borrada y sin correo `.local`. Asignarle una tarea a
// una cuenta técnica es lo mismo que no asignarla.
//
// Quien crea la tarea queda como su creador (`activities.createdById`); `userId` pasa a ser el
// asignado: es de quien aparece en la Agenda.
//
// «Su equipo» y «su plaza» son las mismas definiciones que Metas (#895), Cotizaciones (#867) y
// Reportes (#893). Un GERENTE sin plaza no amplía a ciegas: se queda en lo propio.
//
// Módulo puro: sin Prisma en tiempo de ejecución ni sesión, para probarlo rol por rol.

import type { Plaza, Prisma } from "@prisma/client"
import { ROLES_RUTEABLES, esCuentaTecnica, usuarioRuteableWhere } from "@/lib/workflows/ruteables"

/** Los roles que pueden asignarle tareas a otra persona. */
export const ASIGNAN_TAREAS: readonly string[] = ["ADMIN", "DIRECTOR", "GERENTE", "TEAM_LEADER"]

/** A quién se le puede asignar una tarea (además de a uno mismo). */
export const ROLES_ASIGNABLES: readonly string[] = ROLES_RUTEABLES

export interface ActorAsignacion {
  id: string
  role: string
  plaza?: string | null
}

export interface DestinoAsignacion {
  id: string
  role: string
  plaza?: string | null
  teamLeaderId?: string | null
  isActive: boolean
  deletedAt?: Date | string | null
  email?: string | null
}

export type NivelAsignacion = "TODOS" | "PLAZA" | "EQUIPO" | "SOLO_YO"

export function nivelAsignacion(actor: ActorAsignacion): NivelAsignacion {
  if (actor.role === "ADMIN" || actor.role === "DIRECTOR") return "TODOS"
  if (actor.role === "GERENTE") return actor.plaza ? "PLAZA" : "SOLO_YO"
  if (actor.role === "TEAM_LEADER") return "EQUIPO"
  return "SOLO_YO"
}

/** ¿Puede `actor` dejarle una tarea a `destino`? Asignársela a uno mismo siempre se puede. */
export function puedeAsignarTareaA(actor: ActorAsignacion, destino: DestinoAsignacion): boolean {
  if (destino.id === actor.id) return true

  if (!ROLES_ASIGNABLES.includes(destino.role)) return false
  if (!destino.isActive || destino.deletedAt || esCuentaTecnica(destino.email)) return false

  const nivel = nivelAsignacion(actor)
  if (nivel === "TODOS") return true
  if (nivel === "PLAZA") return !!destino.plaza && destino.plaza === actor.plaza
  if (nivel === "EQUIPO") return destino.teamLeaderId === actor.id
  return false
}

/**
 * Los usuarios a los que `actor` puede asignar tareas, SIN contarse a sí mismo (la lista del
 * selector lo agrega primero). `null` = a nadie más. Tiene que coincidir con `puedeAsignarTareaA`:
 * la prueba de este módulo recorre la misma tabla con las dos funciones.
 */
export function asignablesWhere(actor: ActorAsignacion): Prisma.UserWhereInput | null {
  const nivel = nivelAsignacion(actor)
  if (nivel === "SOLO_YO") return null
  const base: Prisma.UserWhereInput = {
    role: { in: [...ROLES_RUTEABLES] },
    ...usuarioRuteableWhere(),
    id: { not: actor.id },
  }
  if (nivel === "PLAZA") return { ...base, plaza: actor.plaza as Plaza }
  if (nivel === "EQUIPO") return { ...base, teamLeaderId: actor.id }
  return base
}

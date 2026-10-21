import { describe, it, expect, vi, beforeEach } from "vitest"

// #915: el efecto del aviso. Lee al asignado, no avisa a quien no toca y NUNCA lanza.

vi.mock("@/lib/db", () => ({ default: {} }))

import { avisarAsignacion } from "./avisar-asignacion"

const userFindUnique = vi.fn()
const conversationFindFirst = vi.fn()
const notificationCreate = vi.fn()
const db = {
  user: { findUnique: userFindUnique },
  conversation: { findFirst: conversationFindFirst },
  notification: { create: notificationCreate },
} as never

const PEDRO = { id: "ase-1", email: "pedro@propyte.com", isActive: true, deletedAt: null }

beforeEach(() => {
  ;[userFindUnique, conversationFindFirst, notificationCreate].forEach((m) => m.mockReset())
  userFindUnique.mockResolvedValue(PEDRO)
  conversationFindFirst.mockResolvedValue({ id: "conv-7" })
  notificationCreate.mockResolvedValue({ id: "n1" })
})

describe("avisarAsignacion", () => {
  it("reasignar un contacto: avisa al nuevo asesor y lo lleva al hilo de la Bandeja", async () => {
    const r = await avisarAsignacion(
      { tipo: "conversacion", contactoId: "c1", contactoNombre: "Ana López", asignadoId: "ase-1", actorId: "ger-1", actorNombre: "Carlos" },
      db,
    )
    expect(r).toEqual({ avisado: true, notificationId: "n1" })
    expect(conversationFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { contactId: "c1" } }))
    expect(notificationCreate).toHaveBeenCalledWith({
      data: {
        userId: "ase-1",
        type: "conversation_assigned",
        title: "Se te ha asignado una conversación",
        message: "Ana López · Te la asignó Carlos",
        link: "/inbox?c=conv-7",
      },
    })
  })

  it("sin hilo, el aviso lleva a la ficha", async () => {
    conversationFindFirst.mockResolvedValue(null)
    await avisarAsignacion({ tipo: "conversacion", contactoId: "c1", asignadoId: "ase-1", actorId: null }, db)
    expect(notificationCreate.mock.calls[0][0].data.link).toBe("/contacts/c1")
  })

  it("con el hilo ya conocido no lo busca", async () => {
    await avisarAsignacion(
      { tipo: "conversacion", contactoId: "c1", conversationId: "conv-1", asignadoId: "ase-1", actorId: null },
      db,
    )
    expect(conversationFindFirst).not.toHaveBeenCalled()
    expect(notificationCreate.mock.calls[0][0].data.link).toBe("/inbox?c=conv-1")
  })

  it("asignarse algo a uno mismo no avisa ni consulta", async () => {
    const r = await avisarAsignacion({ tipo: "tarea", tareaId: "t", asunto: "x", asignadoId: "u1", actorId: "u1" }, db)
    expect(r).toEqual({ avisado: false, motivo: "se_lo_asigno_a_si_mismo" })
    expect(userFindUnique).not.toHaveBeenCalled()
    expect(notificationCreate).not.toHaveBeenCalled()
  })

  it("quitar la asignación no avisa", async () => {
    const r = await avisarAsignacion({ tipo: "conversacion", contactoId: "c1", asignadoId: null, actorId: "u1" }, db)
    expect(r).toEqual({ avisado: false, motivo: "sin_asignado" })
  })

  it("no avisa a una cuenta técnica ni a una inactiva", async () => {
    userFindUnique.mockResolvedValueOnce({ ...PEDRO, email: "agentes@propyte.local" })
    expect(
      await avisarAsignacion({ tipo: "tarea", tareaId: "t", asunto: "x", asignadoId: "ase-1", actorId: null }, db),
    ).toEqual({ avisado: false, motivo: "cuenta_tecnica" })
    userFindUnique.mockResolvedValueOnce({ ...PEDRO, isActive: false })
    expect(
      await avisarAsignacion({ tipo: "tarea", tareaId: "t", asunto: "x", asignadoId: "ase-1", actorId: null }, db),
    ).toEqual({ avisado: false, motivo: "usuario_inactivo" })
    expect(notificationCreate).not.toHaveBeenCalled()
  })

  it("si la base falla, no lanza: la asignación ya quedó escrita", async () => {
    notificationCreate.mockRejectedValue(new Error("boom"))
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(
      avisarAsignacion({ tipo: "negocio", negocioId: "d1", asignadoId: "ase-1", actorId: null }, db),
    ).resolves.toEqual({ avisado: false, motivo: "error" })
    err.mockRestore()
  })

  it("si ni siquiera hay cliente de base de datos, tampoco lanza", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(
      avisarAsignacion({ tipo: "negocio", negocioId: "d1", asignadoId: "ase-1", actorId: null }),
    ).resolves.toEqual({ avisado: false, motivo: "error" })
    err.mockRestore()
  })
})

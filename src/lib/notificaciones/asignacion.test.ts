import { describe, it, expect } from "vitest"
import {
  armarAvisoAsignacion,
  motivoSinAviso,
  TIPOS_AVISO_ASIGNACION,
  TIPO_AVISO_CONVERSACION,
  TIPO_AVISO_NEGOCIO,
  TIPO_AVISO_TAREA,
} from "./asignacion"

// #915: a quién NO se avisa y qué dice el aviso «Se te ha asignado…».

const PERSONA = { id: "ase-1", email: "pedro@propyte.com", isActive: true, deletedAt: null }

describe("motivoSinAviso", () => {
  it("avisa a una persona activa que no es quien asignó", () => {
    expect(motivoSinAviso({ asignadoId: "ase-1", actorId: "tl-1" }, PERSONA)).toBeNull()
  })

  it("avisa cuando asigna el sistema (actorId null)", () => {
    expect(motivoSinAviso({ asignadoId: "ase-1", actorId: null }, PERSONA)).toBeNull()
  })

  it("no avisa si se quitó la asignación", () => {
    expect(motivoSinAviso({ asignadoId: null, actorId: "tl-1" }, null)).toBe("sin_asignado")
  })

  it("no avisa a quien se lo asignó a sí mismo", () => {
    expect(motivoSinAviso({ asignadoId: "ase-1", actorId: "ase-1" }, PERSONA)).toBe("se_lo_asigno_a_si_mismo")
  })

  it("no avisa a un usuario que no existe", () => {
    expect(motivoSinAviso({ asignadoId: "x", actorId: "tl-1" }, null)).toBe("usuario_no_existe")
  })

  it("no avisa a una cuenta inactiva ni borrada (nadie la abre)", () => {
    expect(motivoSinAviso({ asignadoId: "ase-1", actorId: "tl-1" }, { ...PERSONA, isActive: false })).toBe(
      "usuario_inactivo",
    )
    expect(
      motivoSinAviso({ asignadoId: "ase-1", actorId: "tl-1" }, { ...PERSONA, deletedAt: new Date() }),
    ).toBe("usuario_inactivo")
  })

  it("no avisa a una cuenta técnica .local (#734: agentes@ acumula 91 sin leer)", () => {
    expect(
      motivoSinAviso({ asignadoId: "ase-1", actorId: "tl-1" }, { ...PERSONA, email: "agentes@propyte.local" }),
    ).toBe("cuenta_tecnica")
  })
})

describe("armarAvisoAsignacion", () => {
  it("tarea: título, asunto, vencimiento en hora de Cancún, contacto y quién la asignó", () => {
    const a = armarAvisoAsignacion({
      tipo: "tarea",
      tareaId: "t1",
      asunto: "Llamar para confirmar visita",
      vence: new Date("2026-10-22T20:00:00Z"), // 15:00 en Cancún
      contactoNombre: "Ana López",
      asignadoId: "ase-1",
      actorId: "tl-1",
      actorNombre: "Laura TL",
    })
    expect(a.userId).toBe("ase-1")
    expect(a.type).toBe(TIPO_AVISO_TAREA)
    expect(a.title).toBe("Se te ha asignado una tarea")
    expect(a.message).toContain("Llamar para confirmar visita — vence")
    expect(a.message).toMatch(/15:00|3:00/)
    expect(a.message).toContain("· Ana López")
    expect(a.message).toContain("Te la asignó Laura TL")
    expect(a.link).toBe("/agenda")
  })

  it("tarea del sistema: sin «Te la asignó»", () => {
    const a = armarAvisoAsignacion({
      tipo: "tarea",
      tareaId: "t1",
      asunto: "Seguimiento",
      asignadoId: "ase-1",
      actorId: null,
    })
    expect(a.message).toBe("Seguimiento")
  })

  it("conversación con hilo: abre la Bandeja en ese hilo", () => {
    const a = armarAvisoAsignacion({
      tipo: "conversacion",
      contactoId: "c1",
      contactoNombre: "Ana López",
      conversationId: "conv-9",
      asignadoId: "ase-1",
      actorId: "ger-1",
      actorNombre: "Carlos Gerente",
    })
    expect(a.type).toBe(TIPO_AVISO_CONVERSACION)
    expect(a.title).toBe("Se te ha asignado una conversación")
    expect(a.message).toBe("Ana López · Te la asignó Carlos Gerente")
    expect(a.link).toBe("/inbox?c=conv-9")
  })

  it("conversación sin hilo: abre la ficha del contacto", () => {
    const a = armarAvisoAsignacion({
      tipo: "conversacion",
      contactoId: "c1",
      contactoNombre: "  ",
      conversationId: null,
      asignadoId: "ase-1",
      actorId: null,
    })
    expect(a.message).toBe("Un contacto")
    expect(a.link).toBe("/contacts/c1")
  })

  it("negocio: título, contacto, desarrollo y enlace al negocio", () => {
    const a = armarAvisoAsignacion({
      tipo: "negocio",
      negocioId: "d1",
      contactoNombre: "Ana López",
      desarrollo: "Kaab",
      asignadoId: "ase-1",
      actorId: "dir-1",
      actorNombre: "Dirección",
    })
    expect(a.type).toBe(TIPO_AVISO_NEGOCIO)
    expect(a.title).toBe("Se te ha asignado un negocio")
    expect(a.message).toBe("Ana López · Kaab · Te lo asignó Dirección")
    expect(a.link).toBe("/pipeline/d1")
  })

  it("recorta mensajes largos para la campana", () => {
    const a = armarAvisoAsignacion({
      tipo: "tarea",
      tareaId: "t1",
      asunto: "x".repeat(500),
      asignadoId: "ase-1",
      actorId: null,
    })
    expect(a.message.length).toBeLessThanOrEqual(280)
    expect(a.message.endsWith("…")).toBe(true)
  })

  it("la lista para la campana incluye los cuatro tipos de asignación", () => {
    expect([...TIPOS_AVISO_ASIGNACION].sort()).toEqual(
      ["conversation_assigned", "deal_assigned", "lead_assigned", "task_assigned"],
    )
  })
})

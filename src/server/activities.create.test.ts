import { describe, it, expect, vi, beforeEach } from "vitest"

const contactFindUnique = vi.fn()
const dealFindUnique = vi.fn()
const activityCreate = vi.fn()

vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    deal: { findUnique: (...a: unknown[]) => dealFindUnique(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
  },
}))

vi.mock("@/lib/auth/session", () => ({
  getServerSession: async () => ({ user: { id: "user-1", role: "ASESOR" } }),
}))

// Stub async plano: un mock que rechaza haría fallar el test aunque el código lo capture.
vi.mock("@/lib/webhooks/dispatcher", () => ({ dispatchWebhook: async () => undefined }))

import { createActivity } from "./activities"

beforeEach(() => {
  contactFindUnique.mockReset()
  dealFindUnique.mockReset()
  activityCreate.mockReset()
  activityCreate.mockResolvedValue({ id: "act-1", contactId: null, userId: "user-1" })
})

describe("createActivity sin contacto (actividad personal)", () => {
  it("crea la actividad con contactId null y no valida contacto", async () => {
    await createActivity({ activityType: "TASK", subject: "Preparar propuesta" })

    expect(contactFindUnique).not.toHaveBeenCalled()
    expect(activityCreate.mock.calls[0][0].data.contactId).toBeNull()
    expect(activityCreate.mock.calls[0][0].data.userId).toBe("user-1")
  })

  it("una TASK personal nace PENDIENTE", async () => {
    await createActivity({ activityType: "TASK", subject: "Revisar contrato" })
    expect(activityCreate.mock.calls[0][0].data.status).toBe("PENDIENTE")
  })
})

describe("createActivity con contacto (comportamiento existente)", () => {
  it("sigue validando que el contacto exista", async () => {
    contactFindUnique.mockResolvedValue({ id: "c-1" })
    await createActivity({ contactId: "c-1", activityType: "NOTE", subject: "Llamada" })

    expect(contactFindUnique).toHaveBeenCalledOnce()
    expect(activityCreate.mock.calls[0][0].data.contactId).toBe("c-1")
  })

  it("sigue lanzando si el contacto no existe", async () => {
    contactFindUnique.mockResolvedValue(null)
    await expect(
      createActivity({ contactId: "no-existe", activityType: "NOTE", subject: "X" }),
    ).rejects.toThrow("Contacto no encontrado")
  })
})

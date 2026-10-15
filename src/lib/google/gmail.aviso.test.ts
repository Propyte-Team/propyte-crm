import { describe, it, expect, vi, beforeEach } from "vitest"

// #889 — al registrar un correo ENTRANTE de un contacto se crea el aviso para el asesor.

// vi.hoisted: la fábrica de vi.mock sube al inicio del archivo y no ve un const normal.
const db = vi.hoisted(() => ({
  activity: { findUnique: vi.fn(), create: vi.fn() },
  contact: { findFirst: vi.fn() },
  gmailThread: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  notification: { create: vi.fn() },
  googleOAuthToken: { findUnique: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ default: db }))
vi.mock("./workspace.service", () => ({ getGmailClient: vi.fn() }))

import { logGmailMessageById } from "./gmail"

const C = "86cb4b82-27aa-41b9-bdce-61d1938117cf"
const OWNER = "sistemas@propyte.com"

function gmailCon(from: string, to: string, fechaMs: number) {
  return {
    users: {
      messages: {
        get: vi.fn(async () => ({
          data: {
            threadId: "t1",
            snippet: "Estimada Karla. Como te comentaba…",
            internalDate: String(fechaMs),
            payload: {
              headers: [
                { name: "From", value: from },
                { name: "To", value: to },
                { name: "Subject", value: "Re: Correo de prueba" },
              ],
            },
          },
        })),
      },
    },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  db.activity.findUnique.mockResolvedValue(null)
  db.activity.create.mockResolvedValue({})
  db.contact.findFirst.mockResolvedValue({ id: C, doNotContact: false, firstName: "Yair", lastName: "Guzman" })
  db.gmailThread.findUnique.mockResolvedValue({ direction: "OUTBOUND", subject: "Correo de prueba" })
  db.gmailThread.update.mockResolvedValue({})
  db.notification.create.mockResolvedValue({})
})

describe("logGmailMessageById — aviso de correo entrante", () => {
  it("respuesta de un cliente → EMAIL_RECEIVED + aviso al dueño del buzón con enlace a la ficha", async () => {
    const ok = await logGmailMessageById("asesor-1", "m1", gmailCon("Yair Guzman <yair@ekasa.mx>", OWNER, Date.now()), OWNER)
    expect(ok).toBe(true)
    expect(db.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ activityType: "EMAIL_RECEIVED", contactId: C }) }),
    )
    expect(db.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "asesor-1",
        type: "email_inbound",
        title: "Correo de Yair Guzman",
        link: `/contacts/${C}`,
      }),
    })
  })

  it("lo que manda el propio asesor (saliente) no avisa", async () => {
    await logGmailMessageById("asesor-1", "m2", gmailCon(OWNER, "yair@ekasa.mx", Date.now()), OWNER)
    expect(db.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ activityType: "EMAIL_SENT" }) }),
    )
    expect(db.notification.create).not.toHaveBeenCalled()
  })

  it("un correo ya registrado no vuelve a avisar", async () => {
    db.activity.findUnique.mockResolvedValue({ id: "ya" })
    const ok = await logGmailMessageById("asesor-1", "m1", gmailCon("yair@ekasa.mx", OWNER, Date.now()), OWNER)
    expect(ok).toBe(false)
    expect(db.notification.create).not.toHaveBeenCalled()
  })

  it("de alguien que no es contacto → ni registro ni aviso (sin contactos fantasma)", async () => {
    db.contact.findFirst.mockResolvedValue(null)
    await logGmailMessageById("asesor-1", "m3", gmailCon("spam@x.com", OWNER, Date.now()), OWNER)
    expect(db.activity.create).not.toHaveBeenCalled()
    expect(db.notification.create).not.toHaveBeenCalled()
  })

  it("un correo de hace días se registra pero no avisa", async () => {
    const hace3dias = Date.now() - 3 * 24 * 3600 * 1000
    const ok = await logGmailMessageById("asesor-1", "m4", gmailCon("yair@ekasa.mx", OWNER, hace3dias), OWNER)
    expect(ok).toBe(true)
    expect(db.notification.create).not.toHaveBeenCalled()
  })

  it("si el aviso falla, el correo queda registrado igual (y se deja rastro en el log)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    db.notification.create.mockRejectedValue(new Error("db"))
    const ok = await logGmailMessageById("asesor-1", "m5", gmailCon("yair@ekasa.mx", OWNER, Date.now()), OWNER)
    expect(ok).toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

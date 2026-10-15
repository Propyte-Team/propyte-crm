import { describe, it, expect, vi, beforeEach } from "vitest"

// #885 — POST /api/email/enviar: la ruta genérica que reemplaza a /api/google/gmail/send.

const getServerSession = vi.fn()
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }))
const findUnique = vi.fn()
vi.mock("@/lib/db", () => ({ default: { contact: { findUnique: (...a: unknown[]) => findUnique(...a) } } }))
const puedeTocarRecord = vi.fn()
vi.mock("@/lib/rbac/record-access", () => ({ puedeTocarRecord: (...a: unknown[]) => puedeTocarRecord(...a) }))
const resolverCorreoDelUsuario = vi.fn()
vi.mock("@/lib/email/providers", () => {
  class CorreoNoConectadoError extends Error {}
  return { resolverCorreoDelUsuario: (...a: unknown[]) => resolverCorreoDelUsuario(...a), CorreoNoConectadoError }
})

import { POST } from "./route"
import { POST as POST_ALIAS } from "@/app/api/google/gmail/send/route"
import { CorreoNoConectadoError } from "@/lib/email/providers"

const C = "00000000-0000-4000-8000-000000000001"
const D = "00000000-0000-4000-8000-000000000002"
const body = { contactId: C, to: "cliente@x.com", subject: "Hola", body: "<p>Hola</p>" }
const post = (b: unknown, fn = POST) =>
  fn(new Request("https://x/api/email/enviar", { method: "POST", body: JSON.stringify(b) }) as never)

const enviar = vi.fn()
const listo = {
  provider: { id: "gmail", enviar: (...a: unknown[]) => enviar(...a) },
  estado: { conectado: true, requiereReconexion: false },
}

beforeEach(() => {
  vi.resetAllMocks()
  getServerSession.mockResolvedValue({ user: { id: "asesor-1", role: "ASESOR" } })
  findUnique.mockResolvedValue({ id: C, doNotContact: false })
  puedeTocarRecord.mockResolvedValue(true)
  resolverCorreoDelUsuario.mockResolvedValue(listo)
  enviar.mockResolvedValue({ messageId: "m1", threadId: "t1", from: "a@propyte.com" })
})

describe("POST /api/email/enviar", () => {
  it("sin sesión → 401", async () => {
    getServerSession.mockResolvedValue(null)
    expect((await post(body)).status).toBe(401)
  })

  it("cuerpo inválido → 400 sin enviar", async () => {
    expect((await post({ ...body, to: "no-es-correo" })).status).toBe(400)
    expect((await post({ ...body, subject: "" })).status).toBe(400)
    expect(enviar).not.toHaveBeenCalled()
  })

  it("contacto inexistente → 404", async () => {
    findUnique.mockResolvedValue(null)
    expect((await post(body)).status).toBe(404)
  })

  it("🚨 contacto ajeno → el mismo 404, y no se envía nada", async () => {
    puedeTocarRecord.mockResolvedValue(false)
    const r = await post(body)
    expect(r.status).toBe(404)
    expect(puedeTocarRecord).toHaveBeenCalledWith("contact", C, { id: "asesor-1", role: "ASESOR" }, "editar")
    expect(enviar).not.toHaveBeenCalled()
  })

  it("🚨 negocio ajeno → 404, y no se envía nada", async () => {
    puedeTocarRecord.mockImplementation(async (obj: string) => obj === "contact")
    expect((await post({ ...body, dealId: D })).status).toBe(404)
    expect(enviar).not.toHaveBeenCalled()
  })

  it("No contactar → 422", async () => {
    findUnique.mockResolvedValue({ id: C, doNotContact: true })
    expect((await post(body)).status).toBe(422)
    expect(enviar).not.toHaveBeenCalled()
  })

  it.each([
    ["sin cuenta", { provider: null, estado: { conectado: false, requiereReconexion: false } }],
    ["cuenta vencida", { ...listo, estado: { conectado: true, requiereReconexion: true } }],
  ])("%s → 409 con el estado, sin intentar enviar", async (_n, res) => {
    resolverCorreoDelUsuario.mockResolvedValue(res)
    const r = await post(body)
    expect(r.status).toBe(409)
    expect(((await r.json()) as { error: string }).error).toContain("Conecta tu cuenta de correo")
    expect(enviar).not.toHaveBeenCalled()
  })

  it("envía con el proveedor del asesor y devuelve 201", async () => {
    const r = await post({ ...body, dealId: D, from: "ventas@propyte.com" })
    expect(r.status).toBe(201)
    expect(await r.json()).toEqual({ data: { messageId: "m1", threadId: "t1", proveedor: "gmail" } })
    expect(enviar).toHaveBeenCalledWith({
      userId: "asesor-1",
      contactId: C,
      dealId: D,
      to: "cliente@x.com",
      subject: "Hola",
      html: "<p>Hola</p>",
      from: "ventas@propyte.com",
      threadId: undefined,
    })
  })

  it("el proveedor dice que se desconectó a media marcha → 409", async () => {
    enviar.mockRejectedValue(new CorreoNoConectadoError("x"))
    expect((await post(body)).status).toBe(409)
  })

  it("otro fallo → 500 sin filtrar el error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    enviar.mockRejectedValue(new Error("boom"))
    const r = await post(body)
    expect(r.status).toBe(500)
    expect(((await r.json()) as { error: string }).error).toBe("No se pudo enviar el correo")
    error.mockRestore()
  })

  it("la dirección vieja /api/google/gmail/send sigue funcionando (alias)", async () => {
    expect(POST_ALIAS).toBe(POST)
    expect((await post(body, POST_ALIAS)).status).toBe(201)
  })
})

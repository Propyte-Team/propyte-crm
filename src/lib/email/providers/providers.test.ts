import { describe, it, expect, vi, beforeEach } from "vitest"

// #885 — la capa de proveedores: resolución por usuario y el adaptador de Gmail.

const getConnectionStatus = vi.fn()
vi.mock("@/lib/google/workspace.service", () => {
  class GWNotConnectedError extends Error {}
  return { getConnectionStatus: (...a: unknown[]) => getConnectionStatus(...a), GWNotConnectedError }
})
const sendGmail = vi.fn()
const logOutboundSend = vi.fn()
const listSendAsAddresses = vi.fn()
vi.mock("@/lib/google/gmail", () => ({
  sendGmail: (...a: unknown[]) => sendGmail(...a),
  logOutboundSend: (...a: unknown[]) => logOutboundSend(...a),
  listSendAsAddresses: (...a: unknown[]) => listSendAsAddresses(...a),
}))

import { resolverCorreoDelUsuario, PROVEEDORES, CorreoNoConectadoError } from "./index"
import { gmailProvider, htmlToSnippet } from "./gmail"
import { GWNotConnectedError } from "@/lib/google/workspace.service"

beforeEach(() => {
  vi.resetAllMocks()
  listSendAsAddresses.mockResolvedValue([])
})

describe("resolverCorreoDelUsuario", () => {
  it("sin conexión → sin proveedor, pero dice a dónde ir a conectar y qué proveedores hay", async () => {
    getConnectionStatus.mockResolvedValue({ connected: false })
    const { provider, estado } = await resolverCorreoDelUsuario("u1")
    expect(provider).toBeNull()
    expect(estado).toMatchObject({ conectado: false, requiereReconexion: false, proveedor: null, urlConectar: "/settings?tab=google" })
    expect(estado.disponibles.map((d) => d.nombre)).toEqual(["Gmail"])
  })

  it("conexión vencida (isValid=false) → proveedor Gmail con requiereReconexion", async () => {
    getConnectionStatus.mockResolvedValue({ connected: true, isValid: false, googleEmail: "a@propyte.com" })
    const { provider, estado } = await resolverCorreoDelUsuario("u1")
    expect(provider?.id).toBe("gmail")
    expect(estado).toMatchObject({ conectado: true, requiereReconexion: true, nombreProveedor: "Gmail", cuenta: "a@propyte.com" })
  })

  it("conectado y vigente → listo para enviar", async () => {
    getConnectionStatus.mockResolvedValue({ connected: true, isValid: true, googleEmail: "a@propyte.com" })
    const { estado } = await resolverCorreoDelUsuario("u1")
    expect(estado).toMatchObject({ conectado: true, requiereReconexion: false, proveedor: "gmail" })
  })

  it("hoy el único proveedor registrado es Gmail", () => {
    expect(PROVEEDORES.map((p) => p.id)).toEqual(["gmail"])
  })
})

describe("gmailProvider.enviar", () => {
  const base = { userId: "u1", contactId: "c1", to: "cliente@x.com", subject: "Hola", html: "<p>Hola <b>Ana</b></p>" }

  it("envía y registra en el historial con el resumen en texto plano", async () => {
    sendGmail.mockResolvedValue({ messageId: "m1", threadId: "t1", from: "a@propyte.com" })
    const r = await gmailProvider.enviar({ ...base, dealId: "d1" })
    expect(r).toEqual({ messageId: "m1", threadId: "t1", from: "a@propyte.com" })
    expect(sendGmail).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", to: "cliente@x.com", from: undefined }))
    expect(logOutboundSend).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: "c1", dealId: "d1", messageId: "m1", threadId: "t1", snippet: "Hola Ana" }),
    )
  })

  it("un remitente que no está entre los verificados se ignora (sale desde la cuenta)", async () => {
    listSendAsAddresses.mockResolvedValue([{ email: "ventas@propyte.com", name: "", isPrimary: false, isDefault: false }])
    sendGmail.mockResolvedValue({ messageId: "m", threadId: "t", from: "x" })
    await gmailProvider.enviar({ ...base, from: "director@propyte.com" })
    expect(sendGmail).toHaveBeenCalledWith(expect.objectContaining({ from: undefined }))
    await gmailProvider.enviar({ ...base, from: "Ventas@Propyte.com" })
    expect(sendGmail).toHaveBeenLastCalledWith(expect.objectContaining({ from: "ventas@propyte.com" }))
  })

  it("sin cuenta conectada → CorreoNoConectadoError (independiente de Gmail) y no registra nada", async () => {
    sendGmail.mockRejectedValue(new GWNotConnectedError("x"))
    await expect(gmailProvider.enviar(base)).rejects.toBeInstanceOf(CorreoNoConectadoError)
    expect(logOutboundSend).not.toHaveBeenCalled()
  })

  it("otros errores pasan tal cual", async () => {
    sendGmail.mockRejectedValue(new Error("quota"))
    await expect(gmailProvider.enviar(base)).rejects.toThrow("quota")
  })
})

describe("htmlToSnippet", () => {
  it("quita etiquetas, estilos y &nbsp; y corta a 160", () => {
    expect(htmlToSnippet("<style>p{}</style><p>a&nbsp;b</p>")).toBe("a b")
    expect(htmlToSnippet("x".repeat(200))).toHaveLength(158)
  })
})

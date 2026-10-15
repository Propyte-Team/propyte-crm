import { describe, it, expect, vi, beforeEach } from "vitest"

// #889 — la revisión del correo entrante de todos los buzones conectados.

const findMany = vi.fn()
vi.mock("@/lib/db", () => ({ default: { googleOAuthToken: { findMany: (...a: unknown[]) => findMany(...a) } } }))
const processGmailHistory = vi.fn()
vi.mock("./gmail", () => ({ processGmailHistory: (...a: unknown[]) => processGmailHistory(...a) }))
vi.mock("./workspace.service", () => ({ GWNotConnectedError: class GWNotConnectedError extends Error {} }))

import { sincronizarCorreoEntrante, sincronizarCorreoEntranteTick } from "./gmail-sync"
import { GWNotConnectedError } from "./workspace.service"

beforeEach(() => {
  vi.resetAllMocks()
  findMany.mockResolvedValue([{ userId: "a" }, { userId: "b" }])
})

describe("sincronizarCorreoEntrante", () => {
  it("solo revisa cuentas vigentes y suma lo registrado", async () => {
    processGmailHistory.mockResolvedValueOnce({ logged: 1, skipped: 0 }).mockResolvedValueOnce({ logged: 2, skipped: 1 })
    const r = await sincronizarCorreoEntrante()
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isValid: true } }))
    expect(r).toEqual({ cuentas: 2, registrados: 3, omitidos: 1, desconectadas: 0, errores: [] })
  })

  it("una cuenta desconectada no es error y no frena a la siguiente", async () => {
    processGmailHistory.mockRejectedValueOnce(new GWNotConnectedError("x")).mockResolvedValueOnce({ logged: 1, skipped: 0 })
    const r = await sincronizarCorreoEntrante()
    expect(r).toMatchObject({ desconectadas: 1, registrados: 1, errores: [] })
  })

  it("otro error se reporta con la cuenta y tampoco frena a la siguiente", async () => {
    processGmailHistory.mockRejectedValueOnce(new Error("Gmail 503")).mockResolvedValueOnce({ logged: 1, skipped: 0 })
    const r = await sincronizarCorreoEntrante()
    expect(r.errores).toEqual(["a: Gmail 503"])
    expect(r.registrados).toBe(1)
  })
})

describe("sincronizarCorreoEntranteTick", () => {
  it("con errores lanza DESPUÉS de revisar todas (el tick la reporta como fallo)", async () => {
    processGmailHistory.mockRejectedValueOnce(new Error("Gmail 503")).mockResolvedValueOnce({ logged: 1, skipped: 0 })
    await expect(sincronizarCorreoEntranteTick()).rejects.toThrow(/1 cuenta\(s\) con error/)
    expect(processGmailHistory).toHaveBeenCalledTimes(2)
  })

  it("solo desconectadas → no lanza", async () => {
    processGmailHistory.mockRejectedValue(new GWNotConnectedError("x"))
    await expect(sincronizarCorreoEntranteTick()).resolves.toMatchObject({ desconectadas: 2 })
  })
})

import { describe, it, expect } from "vitest"
import { decidirCorreo, AVISO_SIN_CORREO, type EstadoCorreoCliente } from "./boton-correo"

// #885 — qué hace el botón «Correo» de la ficha en cada caso.

const conectado: EstadoCorreoCliente = {
  conectado: true,
  requiereReconexion: false,
  nombreProveedor: "Gmail",
  urlConectar: "/settings?tab=google",
  disponibles: [{ nombre: "Gmail" }],
}
const sinCuenta: EstadoCorreoCliente = {
  conectado: false,
  requiereReconexion: false,
  nombreProveedor: null,
  urlConectar: "/settings?tab=google",
  disponibles: [{ nombre: "Gmail" }],
}

describe("decidirCorreo", () => {
  it.each([undefined, null, "", "   "])("sin email (%j) → «El correo no está registrado», sin consultar nada", (email) => {
    const d = decidirCorreo({ email, estado: conectado })
    expect(d).toMatchObject({ tipo: "aviso", titulo: "El correo no está registrado" })
    expect(AVISO_SIN_CORREO).toBe("El correo no está registrado")
  })

  it("sin email gana aunque la cuenta no esté conectada (es lo primero que hay que arreglar)", () => {
    expect(decidirCorreo({ email: "", estado: sinCuenta })).toMatchObject({ titulo: AVISO_SIN_CORREO })
  })

  it("No contactar → aviso, no abre el compositor", () => {
    expect(decidirCorreo({ email: "a@b.com", doNotContact: true, estado: conectado })).toMatchObject({
      tipo: "aviso",
      titulo: "El contacto está marcado como No contactar",
    })
  })

  it("con email y sin estado todavía → hay que consultar la cuenta del asesor", () => {
    expect(decidirCorreo({ email: "a@b.com" })).toEqual({ tipo: "consultar" })
  })

  it("asesor sin cuenta conectada → pide conectar Gmail y enlaza a Mi Configuración", () => {
    const d = decidirCorreo({ email: "a@b.com", estado: sinCuenta })
    expect(d).toMatchObject({
      tipo: "aviso",
      titulo: "Conecta tu Gmail para enviar correos",
      enlace: { href: "/settings?tab=google", texto: "Ir a Mi Configuración" },
    })
  })

  it("cuando haya más proveedores, el aviso los nombra todos", () => {
    const d = decidirCorreo({
      email: "a@b.com",
      estado: { ...sinCuenta, disponibles: [{ nombre: "Gmail" }, { nombre: "Outlook" }] },
    })
    expect(d).toMatchObject({ titulo: "Conecta tu Gmail o Outlook para enviar correos" })
  })

  it("conexión vencida → pide reconectar (hoy es el caso de la única cuenta guardada en producción)", () => {
    const d = decidirCorreo({ email: "a@b.com", estado: { ...conectado, requiereReconexion: true } })
    expect(d).toMatchObject({ tipo: "aviso", titulo: "Tu conexión con Gmail venció", enlace: { texto: "Reconectar" } })
  })

  it("todo en orden → abre el compositor", () => {
    expect(decidirCorreo({ email: "a@b.com", doNotContact: false, estado: conectado })).toEqual({ tipo: "abrir" })
  })
})

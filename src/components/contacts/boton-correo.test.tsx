import { describe, it, expect, vi } from "vitest"
import * as React from "react"
import { readFileSync } from "fs"
import path from "path"
import { renderToStaticMarkup } from "react-dom/server"

// tsconfig usa `jsx: preserve`: en vitest el JSX sale como React.createElement.
vi.stubGlobal("React", React)
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }))

import { BotonCorreo } from "./boton-correo"

// #885 — el botón «Correo» de la ficha de contacto.

describe("BotonCorreo", () => {
  it("se llama solo «Correo» y NO se deshabilita aunque falte el email (al hacer clic avisa)", () => {
    const html = renderToStaticMarkup(<BotonCorreo contactId="c1" contactName="Karla" contactEmail={null} />)
    expect(html.replace(/<[^>]+>/g, "").trim()).toBe("Correo")
    expect(html).not.toMatch(/disabled=""/)
    expect(html).toContain('title="El correo no está registrado"')
  })

  it("con email, el título dice a quién se le escribe", () => {
    const html = renderToStaticMarkup(<BotonCorreo contactId="c1" contactName="Karla" contactEmail="karla@x.com" />)
    expect(html).toContain('title="Escribir a karla@x.com"')
  })
})

describe("ficha de contacto — posición del botón", () => {
  it("va a la derecha de «Llamar» y antes de «Crear Deal»", () => {
    const src = readFileSync(path.join(__dirname, "contact-detail.tsx"), "utf8")
    const llamar = src.indexOf("/> Llamar")
    const correo = src.indexOf("<BotonCorreo")
    const deal = src.indexOf("/> Crear Deal")
    expect(llamar).toBeGreaterThan(0)
    expect(correo).toBeGreaterThan(llamar)
    expect(deal).toBeGreaterThan(correo)
  })
})

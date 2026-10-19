import { describe, it, expect, vi } from "vitest"
import * as React from "react"
import { readFileSync } from "fs"
import path from "path"
import { renderToStaticMarkup } from "react-dom/server"

// tsconfig usa `jsx: preserve`: en vitest el JSX sale como React.createElement.
vi.stubGlobal("React", React)

import { ReferidoPorEncabezado } from "./referido-por"

// #909 — «Referido por: <broker>» en el encabezado de la ficha, solo para referidos.

const texto = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()

describe("ReferidoPorEncabezado", () => {
  it("sin broker no pinta nada (los contactos que no son referidos no cambian)", () => {
    expect(renderToStaticMarkup(<ReferidoPorEncabezado referredBy={null} />)).toBe("")
    expect(renderToStaticMarkup(<ReferidoPorEncabezado />)).toBe("")
  })

  it("con broker al alcance: «Referido por: <nombre>» y el nombre abre la ficha del broker", () => {
    const html = renderToStaticMarkup(
      <ReferidoPorEncabezado referredBy={{ id: "brk-1", nombre: "Bruno Broker", puedeAbrir: true }} />,
    )
    expect(texto(html)).toBe("Referido por: Bruno Broker")
    expect(html).toContain('href="/contacts/brk-1"')
  })

  it("con broker fuera de alcance: se nombra, pero sin enlace", () => {
    const html = renderToStaticMarkup(
      <ReferidoPorEncabezado referredBy={{ id: "brk-1", nombre: "Bruno Broker", puedeAbrir: false }} />,
    )
    expect(texto(html)).toBe("Referido por: Bruno Broker")
    expect(html).not.toContain("href=")
  })
})

describe("ficha de contacto — posición de «Referido por»", () => {
  it("va debajo del nombre y arriba de los chips (estado, temperatura, tipo…)", () => {
    const src = readFileSync(path.join(__dirname, "contact-detail.tsx"), "utf8")
    const nombre = src.indexOf("{contact.firstName} {contact.lastName}\n              </h1>")
    const referido = src.indexOf("<ReferidoPorEncabezado")
    const chips = src.indexOf("{/* Chips editables inline */}")
    expect(nombre).toBeGreaterThan(-1)
    expect(referido).toBeGreaterThan(nombre)
    expect(chips).toBeGreaterThan(referido)
  })
})

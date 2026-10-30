import { describe, it, expect, vi } from "vitest"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"

// tsconfig usa `jsx: preserve`: en vitest el JSX sale como React.createElement.
vi.stubGlobal("React", React)

import { BrokerDelContacto } from "./broker-del-contacto"

// #939 — «Registrado por» en «Asignación»: selector de broker según el acceso del campo.

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
const guardar = async () => true
const BROKER = { id: "brk-1", nombre: "Bruno Broker", puedeAbrir: true }

describe("BrokerDelContacto", () => {
  it("HIDDEN: no pinta nada", () => {
    expect(renderToStaticMarkup(<BrokerDelContacto contactId="c1" broker={BROKER} access="HIDDEN" onSave={guardar} />)).toBe("")
  })

  it("READ con broker al alcance: nombre con enlace a su ficha, sin selector", () => {
    const html = renderToStaticMarkup(<BrokerDelContacto contactId="c1" broker={BROKER} access="READ" onSave={guardar} />)
    expect(texto(html)).toBe("Registrado por Bruno Broker")
    expect(html).toContain('href="/contacts/brk-1"')
    expect(html).not.toContain("Quitar contacto")
  })

  it("READ con broker fuera de alcance: nombre sin enlace", () => {
    const html = renderToStaticMarkup(
      <BrokerDelContacto contactId="c1" broker={{ ...BROKER, puedeAbrir: false }} access="READ" onSave={guardar} />,
    )
    expect(texto(html)).toBe("Registrado por Bruno Broker")
    expect(html).not.toContain("href=")
  })

  it("READ sin broker: «—»", () => {
    const html = renderToStaticMarkup(<BrokerDelContacto contactId="c1" broker={null} access="READ" onSave={guardar} />)
    expect(texto(html)).toBe("Registrado por —")
  })

  it("EDIT sin broker: buscador del catálogo («Sin broker · buscar»)", () => {
    const html = renderToStaticMarkup(<BrokerDelContacto contactId="c1" broker={null} access="EDIT" onSave={guardar} />)
    expect(html).toContain('placeholder="Sin broker · buscar"')
  })

  it("EDIT con broker: su nombre con la × para quitarlo y el atajo a su ficha", () => {
    const html = renderToStaticMarkup(<BrokerDelContacto contactId="c1" broker={BROKER} access="EDIT" onSave={guardar} />)
    expect(texto(html)).toContain("Bruno Broker")
    expect(html).toContain('aria-label="Quitar contacto"')
    expect(html).toContain('aria-label="Ver la ficha del broker"')
  })
})

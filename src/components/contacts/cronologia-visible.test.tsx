import { describe, it, expect, vi } from "vitest"
import * as React from "react"
import { readFileSync } from "fs"
import path from "path"
import { renderToStaticMarkup } from "react-dom/server"

// tsconfig usa `jsx: preserve`: en vitest el JSX sale como React.createElement.
vi.stubGlobal("React", React)

import {
  BotonOjoCronologia,
  CLAVE_CRONOLOGIA_VISIBLE,
  CRONOLOGIA_VISIBLE_POR_DEFECTO,
  guardarCronologiaVisible,
  leerCronologiaVisible,
} from "./cronologia-visible"

// #932 — ojo para ocultar/mostrar la Cronología de la ficha de contacto.

function almacen(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial))
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    datos,
  }
}

describe("preferencia de la cronología", () => {
  it("por defecto va oculta (hoy estorba)", () => {
    expect(CRONOLOGIA_VISIBLE_POR_DEFECTO).toBe(false)
    expect(leerCronologiaVisible(almacen())).toBe(false)
    expect(leerCronologiaVisible(null)).toBe(false)
  })

  it("guarda y lee la preferencia", () => {
    const a = almacen()
    guardarCronologiaVisible(true, a)
    expect(a.datos.get(CLAVE_CRONOLOGIA_VISIBLE)).toBe("1")
    expect(leerCronologiaVisible(a)).toBe(true)
    guardarCronologiaVisible(false, a)
    expect(leerCronologiaVisible(a)).toBe(false)
  })

  it("un valor ajeno o un almacén que truena no rompen nada: se usa el defecto", () => {
    expect(leerCronologiaVisible(almacen({ [CLAVE_CRONOLOGIA_VISIBLE]: "quizá" }))).toBe(false)
    const roto = {
      getItem: () => { throw new Error("bloqueado") },
      setItem: () => { throw new Error("bloqueado") },
    }
    expect(leerCronologiaVisible(roto)).toBe(false)
    expect(() => guardarCronologiaVisible(true, roto)).not.toThrow()
  })
})

describe("BotonOjoCronologia", () => {
  it("oculta: ofrece «Mostrar», con su etiqueta accesible", () => {
    const html = renderToStaticMarkup(<BotonOjoCronologia visible={false} onClick={() => {}} />)
    expect(html).toContain('aria-label="Mostrar cronología"')
    expect(html).toContain('aria-pressed="false"')
    expect(html.replace(/<[^>]+>/g, "").trim()).toBe("Mostrar")
  })

  it("visible: ofrece «Ocultar»", () => {
    const html = renderToStaticMarkup(<BotonOjoCronologia visible onClick={() => {}} />)
    expect(html).toContain('aria-label="Ocultar cronología"')
    expect(html).toContain('aria-pressed="true"')
    expect(html.replace(/<[^>]+>/g, "").trim()).toBe("Ocultar")
  })
})

describe("ficha de contacto — la cronología usa el ojo", () => {
  const src = readFileSync(path.join(__dirname, "contact-detail.tsx"), "utf8")
  const seccion = src.slice(src.indexOf('title="Cronología"'), src.indexOf("</Section>", src.indexOf('title="Cronología"')))

  it("el botón va en la cabecera de la sección «Cronología»", () => {
    expect(seccion).toContain("<BotonOjoCronologia")
  })

  it("oculta, la cronología no se monta (ni pide datos al servidor)", () => {
    expect(seccion).toMatch(/cronologiaVisible \? \(\s*<ContactTimeline/)
  })
})

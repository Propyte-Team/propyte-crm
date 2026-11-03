import { describe, it, expect, vi } from "vitest"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"

// tsconfig usa `jsx: preserve`: en vitest el JSX sale como React.createElement.
vi.stubGlobal("React", React)

import { ReclutamientoCard } from "./reclutamiento-card"
import type { CandidatoDeContacto } from "@/server/reclutamiento"

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()

const BASE: CandidatoDeContacto = {
  id: "c1", stage: "ENTREVISTA", source: "CHAT", sourceRef: "conv 1", botResultado: "APTO", botPuntaje: 72,
  botResumen: "Buen perfil", horarioEntrevista: "lunes 10am", cvUrl: "drive.google.com/x", cvFileId: "f9",
}

describe("ReclutamientoCard", () => {
  it("sin candidato no pinta nada", () => {
    expect(renderToStaticMarkup(<ReclutamientoCard candidato={null} />)).toBe("")
  })

  it("candidato del bot: etapa, veredicto, puntaje, resumen, horario y enlaces", () => {
    const html = renderToStaticMarkup(<ReclutamientoCard candidato={BASE} />)
    const t = texto(html)
    expect(t).toContain("Reclutamiento")
    expect(t).toContain("4 · Entrevista Luis")
    expect(html).toContain("#A16207")
    expect(t).toContain("Apto")
    expect(t).toContain("72/100")
    expect(t).toContain("Buen perfil")
    expect(html).toContain("line-clamp-3")
    expect(t).toContain("lunes 10am")
    expect(html).toContain('href="/api/reclutamiento/c1/files/f9"')
    expect(html).toContain('href="https://drive.google.com/x"')
    expect(html).toContain('href="/inbox?c=conv%201"')
    expect(html).toContain('href="/reclutamiento"')
  })

  it("chat sin veredicto → «En guion»; manual sin enlaces ni conversación", () => {
    expect(texto(renderToStaticMarkup(<ReclutamientoCard candidato={{ ...BASE, botResultado: null }} />))).toContain("En guion")
    const html = renderToStaticMarkup(
      <ReclutamientoCard candidato={{ ...BASE, source: "MANUAL", botResultado: null, botPuntaje: null, cvUrl: null, cvFileId: null }} />,
    )
    expect(html).not.toContain("/inbox")
    expect(html).not.toContain("Ver CV")
    expect(html).not.toContain("En guion")
    expect(html).toContain('href="/reclutamiento"')
  })

  it("cvUrl insegura (javascript:) no se enlaza", () => {
    const html = renderToStaticMarkup(<ReclutamientoCard candidato={{ ...BASE, cvUrl: "javascript:alert(1)" }} />)
    expect(html).not.toContain("javascript:")
    expect(html).not.toContain("Ver enlace")
  })
})

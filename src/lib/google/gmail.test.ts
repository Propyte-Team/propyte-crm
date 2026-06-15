// src/lib/google/gmail.test.ts
// Tests de las funciones puras de Gmail (MIME, parseo de headers, cuerpo).
import { describe, it, expect } from "vitest"
import { encodeHeaderWord, extractEmail, extractEmails, buildRawEmail, extractBody, renderEmailTemplate } from "./gmail"

describe("encodeHeaderWord (RFC 2047)", () => {
  it("deja ASCII intacto", () => {
    expect(encodeHeaderWord("Hello world")).toBe("Hello world")
  })
  it("codifica no-ASCII como encoded-word UTF-8/B", () => {
    const out = encodeHeaderWord("Cotización para José")
    expect(out.startsWith("=?UTF-8?B?")).toBe(true)
    expect(out.endsWith("?=")).toBe(true)
    // decodificable de vuelta
    const b64 = out.slice("=?UTF-8?B?".length, -2)
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe("Cotización para José")
  })
})

describe("extractEmail / extractEmails", () => {
  it("extrae de 'Nombre <a@b.com>' en lowercase", () => {
    expect(extractEmail("Luis Flores <Luis@Propyte.com>")).toBe("luis@propyte.com")
  })
  it("acepta email pelón", () => {
    expect(extractEmail("a@b.com")).toBe("a@b.com")
  })
  it("vacío/null → ''", () => {
    expect(extractEmail(null)).toBe("")
    expect(extractEmail(undefined)).toBe("")
  })
  it("separa múltiples destinatarios", () => {
    expect(extractEmails("A <a@x.com>, b@y.com")).toEqual(["a@x.com", "b@y.com"])
  })
})

describe("buildRawEmail", () => {
  it("genera base64url decodificable con headers y cuerpo", () => {
    const raw = buildRawEmail({ to: "c@d.com", from: "me@propyte.com", subject: "Hola", html: "<p>Hola &amp; adiós</p>" })
    const decoded = Buffer.from(raw, "base64url").toString("utf8")
    expect(decoded).toContain("To: c@d.com")
    expect(decoded).toContain("From: me@propyte.com")
    expect(decoded).toContain("Subject: Hola")
    expect(decoded).toContain("Content-Type: text/html; charset=UTF-8")
    // el cuerpo va base64 tras la línea en blanco
    const body = decoded.split("\r\n\r\n")[1].replace(/\r\n/g, "")
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("<p>Hola &amp; adiós</p>")
  })
  it("codifica el asunto con acentos", () => {
    const raw = buildRawEmail({ to: "c@d.com", from: "m@e.com", subject: "Día de cierre", html: "x" })
    const decoded = Buffer.from(raw, "base64url").toString("utf8")
    expect(decoded).toMatch(/Subject: =\?UTF-8\?B\?/)
  })
})

describe("renderEmailTemplate", () => {
  it("resuelve {{contact.firstName}} y {{contact.lastName}}", () => {
    const out = renderEmailTemplate("Hola {{contact.firstName}} {{contact.lastName}}, saludos", {
      firstName: "Luis",
      lastName: "Flores",
    })
    expect(out).toBe("Hola Luis Flores, saludos")
  })
  it("descarta líneas con variables sin resolver", () => {
    const out = renderEmailTemplate("Hola {{contact.firstName}}\nTu asesor {{advisor.name}} te saluda\nGracias", {
      firstName: "Ana",
    })
    expect(out).toBe("Hola Ana\nGracias")
  })
  it("lastName ausente → cadena vacía, sin romper", () => {
    expect(renderEmailTemplate("{{contact.firstName}} {{contact.lastName}}", { firstName: "Sol" })).toBe("Sol ")
  })
})

describe("extractBody", () => {
  const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url")
  it("toma text/plain y text/html de partes anidadas", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("hola plano") } },
        { mimeType: "text/html", body: { data: b64url("<b>hola html</b>") } },
      ],
    }
    const { text, html } = extractBody(payload)
    expect(text).toBe("hola plano")
    expect(html).toBe("<b>hola html</b>")
  })
  it("payload simple sin parts", () => {
    const payload = { mimeType: "text/plain", body: { data: b64url("simple") } }
    expect(extractBody(payload).text).toBe("simple")
  })
})

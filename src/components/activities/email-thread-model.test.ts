import { describe, it, expect } from "vitest";
import {
  ALTO_INICIAL, ALTO_MAX, ALTO_MIN, CSP_CORREO, SANDBOX_CORREO,
  altoDelCorreo, altoDelDocumento, documentoDelCorreo,
} from "./email-thread-model";

// #888: el cuerpo de cada correo del hilo toma el alto de su contenido (con tope) en vez de un
// iframe fijo de 256 px. Sin jsdom en este repo: la regla vive en un módulo puro.

describe("altoDelDocumento / altoDelCorreo", () => {
  it("un correo de una línea ya no ocupa 256 px (medido en Chromium: offsetHeight 39)", () => {
    expect(altoDelDocumento({ documentElement: { offsetHeight: 39 } })).toBe(ALTO_MIN);
  });
  it("uno mediano toma su alto", () => {
    expect(altoDelDocumento({ documentElement: { offsetHeight: 180.4 } })).toBe(181);
  });
  it("uno largo se queda en el tope y se desplaza dentro", () => {
    expect(altoDelDocumento({ documentElement: { offsetHeight: 1632 } })).toBe(ALTO_MAX);
  });
  it("si no se puede medir, el alto de antes", () => {
    expect(altoDelDocumento(null)).toBe(ALTO_INICIAL);
    expect(altoDelDocumento({ documentElement: null })).toBe(ALTO_INICIAL);
    expect(altoDelCorreo(0)).toBe(ALTO_INICIAL);
    expect(altoDelCorreo(Number.NaN)).toBe(ALTO_INICIAL);
  });
});

describe("el iframe sigue sin ejecutar nada (auditoría 2026-09-10, #760)", () => {
  it("el sandbox da allow-same-origin para medir, y NUNCA allow-scripts", () => {
    const permisos = SANDBOX_CORREO.split(/\s+/);
    expect(permisos).toEqual(["allow-same-origin"]);
    expect(permisos).not.toContain("allow-scripts");
    expect(permisos).not.toContain("allow-forms");
    expect(permisos).not.toContain("allow-popups");
  });

  it("el documento lleva una política que no permite scripts, formularios ni marcos", () => {
    expect(CSP_CORREO).toMatch(/default-src 'none'/);
    expect(CSP_CORREO).toMatch(/script-src 'none'/);
    expect(CSP_CORREO).toMatch(/form-action 'none'/);
    expect(CSP_CORREO).toMatch(/frame-src 'none'/);
    const doc = documentoDelCorreo("<p>hola</p>");
    expect(doc).toContain(`<meta http-equiv="Content-Security-Policy" content="${CSP_CORREO}">`);
    // La política va ANTES del cuerpo: si fuera después, el cuerpo ya se habría interpretado.
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<p>hola</p>"));
  });

  it("el cuerpo va al final, tal cual (ya viene saneado del servidor)", () => {
    expect(documentoDelCorreo("<p>hola</p>").endsWith("<p>hola</p>")).toBe(true);
  });
});

import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// tsconfig usa `jsx: preserve`: en vitest el JSX sale como React.createElement (igual que info-adicional.test.ts).
vi.stubGlobal("React", React);

import { CvVista, type ArchivoCv, type CvVistaProps } from "./cv-contacto";

// #917 — sección «CV» hasta arriba de la ficha.

const base: CvVistaProps = {
  archivos: [],
  puedeSubir: true,
  aviso: null,
  subiendo: false,
  borrando: null,
  error: null,
  onSubir: () => {},
  onBorrar: () => {},
};

const cv = (over: Partial<ArchivoCv> = {}): ArchivoCv => ({
  id: "f1",
  fileName: "CV Ana López.pdf",
  mimeType: "application/pdf",
  sizeBytes: 220 * 1024,
  createdAt: "2026-10-21T17:00:00.000Z",
  uploadedByName: "Felipe Luksic",
  verUrl: "https://s/ver",
  descargarUrl: "https://s/descargar",
  puedeBorrar: false,
  ...over,
});

const html = (p: Partial<CvVistaProps>) => renderToStaticMarkup(createElement(CvVista, { ...base, ...p }));

describe("sin CV", () => {
  it("solo un botón opcional «Subir CV» (no una tarjeta vacía)", () => {
    const h = html({});
    expect(h).toContain("Subir CV");
    expect(h).toContain('data-testid="cv-vacio"');
    expect(h).not.toContain("crm-card");
  });

  it("si el rol no puede subir, no se pinta nada", () => {
    expect(html({ puedeSubir: false })).toBe("");
  });

  it("el error de una subida se ve junto al botón", () => {
    expect(html({ error: "El archivo pesa más de 10 MB." })).toContain("El archivo pesa más de 10 MB.");
  });
});

describe("con CV", () => {
  it("tarjeta con nombre, tipo, tamaño, quién lo subió, «Ver» y «Descargar»", () => {
    const h = html({ archivos: [cv()] });
    expect(h).toContain('data-testid="cv-lista"');
    expect(h).toContain("CV Ana López.pdf");
    expect(h).toContain("PDF · 220 KB");
    expect(h).toContain("Felipe Luksic");
    expect(h).toContain('href="https://s/ver"');
    expect(h).toContain('target="_blank"');
    expect(h).toContain('href="https://s/descargar"');
    expect(h).toContain("Subir otro");
  });

  it("«Borrar» solo en los que puede borrar quien mira", () => {
    const h = html({ archivos: [cv({ id: "a", fileName: "mio.pdf", puedeBorrar: true }), cv({ id: "b", fileName: "ajeno.pdf" })] });
    expect(h).toContain('aria-label="Borrar mio.pdf"');
    expect(h).not.toContain('aria-label="Borrar ajeno.pdf"');
    expect(h).toContain("CV (2)");
  });

  it("quien no puede subir ve la lista pero no «Subir otro»", () => {
    expect(html({ archivos: [cv()], puedeSubir: false })).not.toContain("Subir otro");
  });
});

it("sin migración muestra el aviso", () => {
  expect(html({ aviso: "Falta aplicar la migración de CV" })).toContain("Falta aplicar la migración de CV");
});

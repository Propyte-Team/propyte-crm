import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// tsconfig usa `jsx: preserve`: en vitest el JSX sale como React.createElement.
vi.stubGlobal("React", React);
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));

import { ReclutamientoClient, TablaCandidatos, textoPortafolio } from "./reclutamiento-client";
import type { CandidatoFila } from "@/lib/reclutamiento/shared";

// #926 — lo que pidió sistemas@: las columnas en su orden, «-» en lo vacío, la etapa visible y el CV.

const celdas = (html: string) =>
  [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
    m[1].replace(/<option[\s\S]*?<\/option>/g, "").replace(/<[^>]+>/g, "").trim()
  );

const VACIO: CandidatoFila = {
  id: "c1", fullName: "Rebeca González", age: null, email: null, phone: null, area: null, plaza: null,
  portfolioUrl: null, notes: null, stage: "RECIBIDO", source: "MANUAL", createdAt: "2026-10-23T00:00:00.000Z", cvs: [],
};

const noop = () => {};

describe("Reclutamiento — tabla", () => {
  it("encabezados en el orden pedido", () => {
    const html = renderToStaticMarkup(<TablaCandidatos filas={[]} onEditar={noop} onEtapa={noop} />);
    const ths = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]).filter(Boolean);
    expect(ths).toEqual(["Nombre completo", "Etapa", "Edad", "Correo", "Teléfono", "Área/Puesto", "CV", "Portafolio", "Ubicación", "Notas"]);
  });

  it("vacía: aviso para registrar el primero", () => {
    const html = renderToStaticMarkup(<ReclutamientoClient initial={[]} puedeEliminar={false} />);
    expect(html).toContain("Todavía no hay candidatos.");
    expect(html).toContain("Agregar candidato");
    expect(html).toContain("Desempeño");
  });

  it("todo campo vacío se pinta «-» (la etapa siempre tiene valor)", () => {
    const html = renderToStaticMarkup(<TablaCandidatos filas={[VACIO]} onEditar={noop} onEtapa={noop} />);
    // 10 columnas + acciones; la de etapa es el <select> (sus opciones se quitan al leer → "").
    expect(celdas(html).slice(0, 10)).toEqual(["Rebeca González", "", "-", "-", "-", "-", "-", "-", "-", "-"]);
    expect(html).toMatch(/<option value="RECIBIDO"[^>]*selected="">1 · Recibido<\/option>/);
  });

  it("con datos: correo mailto, portafolio https, ubicación con nombre, CV enlazado y la etapa elegida", () => {
    const html = renderToStaticMarkup(
      <TablaCandidatos
        filas={[{
          ...VACIO,
          age: 27,
          email: "rebeca@mail.com",
          phone: "984 123 4567",
          area: "Marketing",
          plaza: "PDC",
          portfolioUrl: "https://www.behance.net/rebeca/",
          notes: "Buena prueba técnica",
          stage: "CONTACTO_INICIAL",
          cvs: [{ id: "f2", fileName: "cv2.pdf", createdAt: "" }, { id: "f1", fileName: "cv.pdf", createdAt: "" }],
        }]}
        onEditar={noop}
        onEtapa={noop}
      />
    );
    expect(celdas(html).slice(0, 10)).toEqual([
      "Rebeca González", "", "27", "rebeca@mail.com", "984 123 4567", "Marketing", "Ver CV (2)", "behance.net/rebeca", "Playa del Carmen", "Buena prueba técnica",
    ]);
    expect(html).toContain('href="mailto:rebeca@mail.com"');
    expect(html).toContain('href="tel:9841234567"');
    expect(html).toContain('href="https://www.behance.net/rebeca/"');
    // el CV más nuevo, por la ruta que valida acceso y redirige a una URL firmada
    expect(html).toContain('href="/api/reclutamiento/c1/files/f2"');
    expect(html).toMatch(/<option value="CONTACTO_INICIAL"[^>]*selected="">3 · Contacto inicial<\/option>/);
  });

  it("chips de etapa con su conteo, y aviso si falta la migración", () => {
    const html = renderToStaticMarkup(
      <ReclutamientoClient initial={[VACIO, { ...VACIO, id: "c2", stage: "CONTRATADO" }]} puedeEliminar={false} />
    );
    expect(html).toContain("2 candidatos · 1 en proceso");
    const sin = renderToStaticMarkup(<ReclutamientoClient initial={[]} sinMigracion puedeEliminar={false} />);
    expect(sin).toContain("Falta aplicar la migración");
    expect(sin).not.toContain("Agregar candidato");
  });

  it("textoPortafolio quita esquema, www y barra final", () => {
    expect(textoPortafolio("https://www.behance.net/ana/")).toBe("behance.net/ana");
    expect(textoPortafolio("crisdark963.wixsite.com/portafolio")).toBe("crisdark963.wixsite.com/portafolio");
  });
});

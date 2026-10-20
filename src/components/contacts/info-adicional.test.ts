import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// tsconfig usa `jsx: preserve`: en vitest el JSX sale como React.createElement (igual que referido-por.test.tsx).
vi.stubGlobal("React", React);

import { camposAPintar, filasAnuncio, tieneDato, InfoAdicionalSection, AnuncioOrigenSection } from "./info-adicional";

// #914 — tarjetas «Información adicional» y «Anuncio de origen» de la ficha.

const EDIT = () => "EDIT" as const;
const save = async () => true;

describe("qué campos se pintan", () => {
  it("por defecto solo los que tienen dato (false cuenta como dato)", () => {
    const c = { company: "Duke del Caribe", facebook: "  ", inSequence: false, initialMessage: null };
    expect(camposAPintar(c, EDIT, false).map((x) => x.key)).toEqual(["company", "inSequence"]);
  });

  it("«Mostrar vacíos» los pinta todos, en el orden de la lista", () => {
    const todos = camposAPintar({}, EDIT, true).map((x) => x.key);
    expect(todos[0]).toBe("company");
    expect(todos).toHaveLength(11);
  });

  it("los HIDDEN para el rol nunca se pintan, ni con «Mostrar vacíos»", () => {
    const acc = (k: string) => (k === "company" ? ("HIDDEN" as const) : ("EDIT" as const));
    expect(camposAPintar({ company: "Duke" }, acc, true).map((x) => x.key)).not.toContain("company");
  });

  it("tieneDato", () => {
    expect([tieneDato(null), tieneDato(undefined), tieneDato(""), tieneDato(" ")]).toEqual([false, false, false, false]);
    expect([tieneDato("x"), tieneDato(false), tieneDato(true)]).toEqual([true, true, true]);
  });
});

describe("render", () => {
  it("muestra el dato y no las filas vacías", () => {
    const html = renderToStaticMarkup(
      createElement(InfoAdicionalSection, { contact: { company: "Duke del Caribe" }, acc: EDIT, save }),
    );
    expect(html).toContain("Información adicional");
    expect(html).toContain("Duke del Caribe");
    expect(html).not.toContain("Facebook");
    expect(html).toContain("Mostrar vacíos");
  });

  it("contacto sin ningún dato adicional: «Sin datos adicionales»", () => {
    const html = renderToStaticMarkup(createElement(InfoAdicionalSection, { contact: {}, acc: EDIT, save }));
    expect(html).toContain("Sin datos adicionales");
  });

  it("si el rol no ve ninguno, no hay tarjeta", () => {
    const html = renderToStaticMarkup(
      createElement(InfoAdicionalSection, { contact: { company: "Duke" }, acc: () => "HIDDEN" as const, save }),
    );
    expect(html).toBe("");
  });

  it("anuncio de origen: solo filas con dato; sin atribución no hay tarjeta", () => {
    expect(filasAnuncio(null)).toEqual([]);
    expect(filasAnuncio({ campaignName: "83 CAMPAÑA DE EMPLEO", adName: null, formName: "Formulario Asesores" })).toEqual([
      { label: "Campaña", valor: "83 CAMPAÑA DE EMPLEO" },
      { label: "Formulario", valor: "Formulario Asesores" },
    ]);
    expect(renderToStaticMarkup(createElement(AnuncioOrigenSection, { adAttribution: null }))).toBe("");
    const html = renderToStaticMarkup(
      createElement(AnuncioOrigenSection, { adAttribution: { campaignName: "83 CAMPAÑA DE EMPLEO" } }),
    );
    expect(html).toContain("Anuncio de origen");
    expect(html).toContain("83 CAMPAÑA DE EMPLEO");
  });
});

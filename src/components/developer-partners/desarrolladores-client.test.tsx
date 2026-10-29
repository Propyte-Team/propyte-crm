import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// tsconfig usa `jsx: preserve`: en vitest el JSX sale como React.createElement.
vi.stubGlobal("React", React);
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }), usePathname: () => "/empresas" }));
// El cuadro de contactos tiene su propia prueba (de la API); aquí solo la tabla.
vi.mock("./empresa-contactos-dialog", () => ({ EmpresaContactosDialog: () => null }));

import { DesarrolladoresClient, filtrarPorTipo } from "./desarrolladores-client";

// #872 — lo que pidió sistemas@: las columnas, la tabla vacía al inicio y «-» en lo vacío.
// #949 — «Empresas»: columna Tipo y filtro «Tipo de empresa».

const celdas = (html: string) => [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

describe("Empresas — tabla", () => {
  it("título «Empresas» y encabezados en orden", () => {
    const html = renderToStaticMarkup(<DesarrolladoresClient initial={[]} canEdit={false} />);
    expect(html).toContain("Empresas");
    expect(html).not.toContain("Desarrolladores");
    const ths = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]).filter(Boolean);
    expect(ths).toEqual(["Empresa", "Tipo", "Sitio web", "Email", "Teléfono"]);
  });

  it("vacía: muestra el aviso, sin botón de alta para quien solo consulta", () => {
    const html = renderToStaticMarkup(<DesarrolladoresClient initial={[]} canEdit={false} />);
    expect(html).toContain("Todavía no hay empresas registradas.");
    expect(html).not.toContain("Agregar empresa");
  });

  it("ADMIN/DIRECTOR/GERENTE ven el botón de alta", () => {
    const html = renderToStaticMarkup(<DesarrolladoresClient initial={[]} canEdit />);
    expect(html).toContain("Agregar empresa");
  });

  it("filtro «Tipo de empresa» en la pantalla", () => {
    const html = renderToStaticMarkup(<DesarrolladoresClient initial={[]} canEdit={false} />);
    expect(html).toContain('aria-label="Tipo de empresa"');
  });

  it("un campo vacío se pinta «-»", () => {
    const html = renderToStaticMarkup(
      <DesarrolladoresClient
        initial={[{ id: "d1", name: "Onix Living", type: "DESARROLLADORA", website: null, email: "", phone: "984 123 4567" }]}
        canEdit={false}
      />,
    );
    expect(celdas(html)).toEqual(["Onix Living", "Desarrolladora", "-", "-", "984 123 4567"]);
  });

  it("con datos: el sitio es enlace https y el email es mailto", () => {
    const html = renderToStaticMarkup(
      <DesarrolladoresClient
        initial={[{ id: "d1", name: "Onix", type: "INMOBILIARIA", website: "onix.mx", email: "hola@onix.mx", phone: null }]}
        canEdit={false}
      />,
    );
    expect(html).toContain('href="https://onix.mx/"');
    expect(html).toContain('href="mailto:hola@onix.mx"');
    expect(celdas(html)[4]).toBe("-");
  });
});

describe("filtro «Tipo de empresa» (#949)", () => {
  const filas = [
    { id: "1", name: "Ekasa", type: "DESARROLLADORA", website: null, email: null, phone: null },
    { id: "2", name: "Ánfora", type: "INMOBILIARIA", website: null, email: null, phone: null },
    { id: "3", name: "Vieja", type: null, website: null, email: null, phone: null },
  ];
  it("todos, por tipo y sin tipo", () => {
    expect(filtrarPorTipo(filas, "__TODOS__").map((f) => f.id)).toEqual(["1", "2", "3"]);
    expect(filtrarPorTipo(filas, "INMOBILIARIA").map((f) => f.id)).toEqual(["2"]);
    expect(filtrarPorTipo(filas, "PROVEEDOR")).toEqual([]);
    expect(filtrarPorTipo(filas, "SIN_TIPO").map((f) => f.id)).toEqual(["3"]);
  });
});

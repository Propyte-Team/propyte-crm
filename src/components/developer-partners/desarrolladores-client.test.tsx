import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// tsconfig usa `jsx: preserve`: en vitest el JSX sale como React.createElement.
vi.stubGlobal("React", React);
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));

import { DesarrolladoresClient } from "./desarrolladores-client";

// #872 — lo que pidió sistemas@: las cuatro columnas, la tabla vacía al inicio y «-» en lo vacío.

const celdas = (html: string) => [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

describe("Desarrolladores — tabla", () => {
  it("encabezados en el orden pedido", () => {
    const html = renderToStaticMarkup(<DesarrolladoresClient initial={[]} canEdit={false} />);
    const ths = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]).filter(Boolean);
    expect(ths).toEqual(["Desarrollador", "Sitio web", "Email", "Teléfono"]);
  });

  it("vacía: muestra el aviso, sin botón de alta para quien solo consulta", () => {
    const html = renderToStaticMarkup(<DesarrolladoresClient initial={[]} canEdit={false} />);
    expect(html).toContain("Todavía no hay desarrolladores registrados.");
    expect(html).not.toContain("Agregar desarrollador");
  });

  it("ADMIN/DIRECTOR ven el botón de alta", () => {
    const html = renderToStaticMarkup(<DesarrolladoresClient initial={[]} canEdit />);
    expect(html).toContain("Agregar desarrollador");
  });

  it("un campo vacío se pinta «-»", () => {
    const html = renderToStaticMarkup(
      <DesarrolladoresClient
        initial={[{ id: "d1", name: "Onix Living", website: null, email: "", phone: "984 123 4567" }]}
        canEdit={false}
      />,
    );
    expect(celdas(html)).toEqual(["Onix Living", "-", "-", "984 123 4567"]);
  });

  it("con datos: el sitio es enlace https y el email es mailto", () => {
    const html = renderToStaticMarkup(
      <DesarrolladoresClient
        initial={[{ id: "d1", name: "Onix", website: "onix.mx", email: "hola@onix.mx", phone: null }]}
        canEdit={false}
      />,
    );
    expect(html).toContain('href="https://onix.mx/"');
    expect(html).toContain('href="mailto:hola@onix.mx"');
    expect(celdas(html)[3]).toBe("-");
  });
});

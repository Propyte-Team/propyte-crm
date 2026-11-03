import { describe, it, expect } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EstadoDelContacto } from "./estado-del-contacto";

// Vitest compila el JSX en modo clásico (environment: node, sin plugin de React).
(globalThis as unknown as { React: typeof React }).React = React;

// #953 — lo que dibuja el chip de estado: solo los cambios permitidos desde el estado actual, las
// correcciones solo para un administrador, y subestado / razón / ticket donde aplican.
const opciones = (html: string, aria: string) => {
  const select = html.split(`aria-label="${aria}"`)[1]?.split("</select>")[0] ?? "";
  return [...select.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
};

describe("EstadoDelContacto (#953)", () => {
  it("un asesor en Contactado solo ve a dónde puede pasar", () => {
    const html = renderToStaticMarkup(
      <EstadoDelContacto contacto={{ id: "c1", estado: "CONTACTADO", subestado: "EN_CONVERSACION" }} />,
    );
    expect(opciones(html, "Cambiar estado")).toEqual(["Contactado", "Reunión", "Contactado perdido", "Derivado a RH"]);
    expect(html).not.toContain("Corregir (administrador)");
    expect(opciones(html, "Cambiar subestado")).toEqual(["En conversación", "Seguimiento agendado"]);
    expect(html).not.toContain("Ticket");
  });

  it("un administrador ve además las correcciones", () => {
    const html = renderToStaticMarkup(
      <EstadoDelContacto puedeCorregir contacto={{ id: "c1", estado: "CONTACTADO" }} />,
    );
    expect(html).toContain("Corregir (administrador)");
    expect(opciones(html, "Cambiar estado")).toContain("Propuesta");
  });

  it("sin estado dice «Por clasificar» y ofrece todos", () => {
    const html = renderToStaticMarkup(<EstadoDelContacto compacto contacto={{ id: "c1", estado: null }} />);
    expect(html).toContain("Por clasificar");
    // «Por clasificar» + los 16 estados, menos Apartado, Firma, Escritura y Postventa (#957: los marca la operación).
    expect(opciones(html, "Cambiar estado")).toHaveLength(13);
    expect(html).not.toContain("Cambiar subestado"); // compacto: solo el estado
  });

  it("en una salida muestra la razón; desde Demo, el ticket", () => {
    const salida = renderToStaticMarkup(
      <EstadoDelContacto contacto={{ id: "c1", estado: "NEGOCIO_PERDIDO", razonSalida: "PRECIO" }} />,
    );
    expect(salida).toContain("Razón de pérdida: Precio");
    const demo = renderToStaticMarkup(
      <EstadoDelContacto contacto={{ id: "c1", estado: "DEMO", ticketEstimado: "3500000", ticketMoneda: "MXN" }} />,
    );
    expect(demo).toMatch(/Ticket \$3,500,000/);
  });

  it("de solo lectura no dibuja los selectores", () => {
    const html = renderToStaticMarkup(<EstadoDelContacto readOnly contacto={{ id: "c1", estado: "REUNION", subestado: "AGENDADA" }} />);
    expect(html).toContain("Reunión");
    expect(html).not.toContain("<select");
  });
});

import { describe, it, expect } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OperacionesDelContacto, type OperacionDelContacto } from "./operaciones-del-contacto";
import { EstadoDelContacto } from "./estado-del-contacto";

// Vitest compila el JSX en modo clásico (environment: node, sin plugin de React).
(globalThis as unknown as { React: typeof React }).React = React;

// #957 — lo que dibuja la sección Operaciones de la ficha: los botones de la etapa que sigue, las
// casillas de la firma, Reapartar en Apartado, y los negocios anteriores aparte.
const dibujar = (ops: OperacionDelContacto[], readOnly = false) =>
  renderToStaticMarkup(
    <OperacionesDelContacto operaciones={ops} etiquetaEtapaVieja={(s) => (s === "NEGOTIATION" ? "Negociación" : s ?? "—")} readOnly={readOnly} />,
  );
const botones = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

describe("OperacionesDelContacto (#957)", () => {
  it("en preparación: Apartar y Cancelar; sin subestado", () => {
    const html = dibujar([{ id: "d1", etapa: "EN_PREPARACION", tipoOperacion: "VENTA", estimatedValue: "2500000", currency: "MXN" }]);
    expect(html).toContain("En preparación");
    expect(botones(html)).toEqual(["Apartar", "Cancelar operación"]);
    expect(html).not.toContain("Cambiar subestado de la operación");
    expect(html).toContain("$2,500,000");
  });

  it("apartado: subestado, casillas, Pasar a firma, Reapartar y el contador", () => {
    const html = dibujar([
      { id: "d1", etapa: "APARTADO", tipoOperacion: "VENTA", subestado: "PAGADO", reapartados: 2, flujo: "F5_NATIVA" },
    ]);
    expect(html).toContain("Pagado");
    expect(html).toContain("Financiamiento en trámite"); // Nativa
    expect(html).toContain("Contrato firmado");
    expect(html).toContain("Enganche pagado");
    expect(html).toContain("Reapartada 2 veces");
    expect(botones(html)).toEqual(["Pasar a firma", "Reapartar", "Cancelar operación"]);
  });

  it("un contrato MB firmado no tiene casillas ni forma de pago; solo se cancela", () => {
    const html = dibujar([{ id: "d1", etapa: "FIRMA", tipoOperacion: "CONTRATO_MB", subestado: "FIRMADO", propiedadDescripcion: "Lote 12" }]);
    expect(html).toContain("Contrato MB");
    expect(html).toContain("Lote 12");
    expect(html).not.toContain("Contrato firmado");
    expect(html).not.toContain("Forma de pago");
    expect(botones(html)).toEqual(["Cancelar operación"]);
  });

  it("los negocios anteriores van aparte y se pueden usar para cotizar; los cerrados no", () => {
    const html = dibujar([
      { id: "a", etapa: null, stage: "NEGOTIATION" },
      { id: "b", etapa: null, stage: "LOST" },
    ]);
    expect(html).toContain("Negocios anteriores (2)");
    expect(html).toContain("Negocio anterior · Negociación");
    expect(botones(html)).toEqual(["Usar para cotizar o apartar"]);
  });

  it("de solo lectura no hay botones ni selects activos", () => {
    const html = dibujar([{ id: "d1", etapa: "APARTADO", tipoOperacion: "VENTA", subestado: "PAGADO" }], true);
    expect(botones(html)).toEqual([]);
    expect(html).not.toContain("Cambiar subestado de la operación");
  });

  it("el chip de estado del contacto en Firma es de solo lectura para un asesor", () => {
    const html = renderToStaticMarkup(<EstadoDelContacto contacto={{ id: "c1", estado: "FIRMA", subestado: "FIRMADO" }} />);
    expect(html).toContain("Firma");
    expect(html).not.toContain('aria-label="Cambiar estado"');
    expect(html).not.toContain('aria-label="Cambiar subestado"');
    expect(html).toContain("Lo marca la operación");
  });
});

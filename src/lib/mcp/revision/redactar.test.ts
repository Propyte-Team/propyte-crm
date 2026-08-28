import { describe, expect, it } from "vitest";
import { firmaDeError, redactar } from "./redactar";

describe("redactar", () => {
  it("tapa correos", () => {
    expect(redactar("falló para ana.lopez@gmail.com")).toBe("falló para «correo»");
  });

  it("tapa el teléfono en sus cinco formatos", () => {
    // Un teléfono vive en cinco formatos en esta casa y un patrón que cubre uno deja
    // pasar los otros cuatro.
    for (const t of [
      "+52 998 123 4567",
      "5219981234567",
      "998-123-4567",
      "(998) 123 4567",
      "9981234567",
    ]) {
      expect(redactar(`número ${t} inválido`), t).not.toMatch(/\d{8}/);
    }
  });

  it("tapa UUIDs, que identifican una fila", () => {
    expect(redactar("lead 7f3a1b2c-1111-2222-3333-444455556666 no existe")).toContain("«id»");
  });

  it("no destroza el mensaje: el motivo sigue siendo legible", () => {
    // Si la redacción se come el texto entero, el grupo de error deja de ser accionable y
    // la tool pierde su razón de ser.
    const r = redactar("Campo email inválido: ana@x.com (lead 7f3a1b2c-1111-2222-3333-444455556666)");
    expect(r).toContain("Campo email inválido");
  });

  it("aguanta null y vacío", () => {
    expect(redactar(null)).toBe("");
    expect(redactar(undefined)).toBe("");
  });
});

describe("firmaDeError", () => {
  it("agrupa el mismo fallo con distintos identificadores", () => {
    // Sin esto, 400 instancias del MISMO bug se leen como 400 bugs, y esa cifra acaba en
    // una tarea del tablero como si estuviera medida.
    const a = firmaDeError("contacto 7f3a1b2c-1111-2222-3333-444455556666 no encontrado");
    const b = firmaDeError("contacto 9b1c0d2e-5555-6666-7777-888899990000 no encontrado");
    expect(a).toBe(b);
  });

  it("agrupa mensajes que solo difieren en un número o un valor citado", () => {
    expect(firmaDeError("timeout tras 30s")).toBe(firmaDeError("timeout tras 45s"));
    expect(firmaDeError('campo "email" inválido')).toBe(firmaDeError('campo "telefono" inválido'));
  });

  it("NO agrupa fallos realmente distintos", () => {
    expect(firmaDeError("timeout de red")).not.toBe(firmaDeError("credencial vencida"));
  });

  it("acota la longitud para que una firma no sea un párrafo", () => {
    expect(firmaDeError("x".repeat(500)).length).toBeLessThanOrEqual(200);
  });
});

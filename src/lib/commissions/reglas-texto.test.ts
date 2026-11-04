import { describe, expect, it } from "vitest";
import { describirClaveRegla, mensajeReglaDuplicada } from "./reglas-texto";

const reglas = [
  { id: "1", dealType: "NATIVA_CONTADO", leadSourceCategory: "PROPYTE_LEAD", role: "ASESOR_SR", percentage: 2.5 },
];

describe("mensajes en español", () => {
  it("describe la clave sin enums crudos", () => {
    const t = describirClaveRegla(reglas[0]);
    expect(t).not.toMatch(/ASESOR_SR|PROPYTE_LEAD|NATIVA_CONTADO/);
    expect(t).toContain("Nativa Contado");
  });
  it("el aviso de duplicado incluye el porcentaje", () => {
    expect(mensajeReglaDuplicada(reglas[0])).toContain("2.5%");
  });
  it("etiqueta ADMIN", () => {
    expect(
      describirClaveRegla({ dealType: "MACROLOTE", leadSourceCategory: "BROKER_LEAD", role: "ADMIN" }),
    ).toContain("Administrador");
  });
});


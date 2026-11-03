import { describe, it, expect } from "vitest";
import { VEREDICTOS, etapaDeResultado, botPuedeMoverEtapa } from "./etapas";

describe("etapas", () => {
  it("los tres veredictos existen", () => {
    expect(VEREDICTOS).toEqual(["APTO", "REVISAR", "NO_APTO"]);
  });
  it("mapea veredicto a etapa de Notion", () => {
    expect(etapaDeResultado("APTO")).toBe("CONTACTO_INICIAL");
    expect(etapaDeResultado("REVISAR")).toBe("FILTRO_CV");
    expect(etapaDeResultado("NO_APTO")).toBe("DESCARTADO");
  });
  it("el bot solo mueve la etapa si el candidato sigue en RECIBIDO", () => {
    expect(botPuedeMoverEtapa("RECIBIDO")).toBe(true);
    for (const e of ["FILTRO_CV", "CONTACTO_INICIAL", "ENTREVISTA", "CONTRATADO", "DESCARTADO", "BANCO_TALENTO"]) {
      expect(botPuedeMoverEtapa(e), e).toBe(false);
    }
  });
});

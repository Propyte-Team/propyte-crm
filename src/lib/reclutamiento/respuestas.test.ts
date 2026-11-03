import { describe, it, expect } from "vitest";
import { leerRespuestas, PREFIJO_CUSTOM, CLAVES_ACTITUD } from "./respuestas";

describe("leerRespuestas", () => {
  it("toma solo las llaves reclutamiento_* y les quita el prefijo", () => {
    const r = leerRespuestas({
      reclutamiento_plaza: "PDC",
      reclutamiento_colchon_meses: "TRES_A_SEIS",
      propiedad_venta_tipo: "CASA",
      reclutamiento_actitud_1: "Porque me gusta tratar con gente",
    });
    expect(r).toEqual({
      plaza: "PDC",
      colchon_meses: "TRES_A_SEIS",
      actitud_1: "Porque me gusta tratar con gente",
    });
  });

  it("ignora valores vacíos o no string", () => {
    expect(leerRespuestas({ reclutamiento_plaza: "", reclutamiento_ingles: 3 })).toEqual({});
  });

  it("custom null → sin respuestas", () => {
    expect(leerRespuestas(null)).toEqual({});
  });

  it("expone el prefijo y las claves de actitud que usa el playbook", () => {
    expect(PREFIJO_CUSTOM).toBe("reclutamiento_");
    expect(CLAVES_ACTITUD).toEqual(["actitud_1", "actitud_2", "actitud_3"]);
  });
});

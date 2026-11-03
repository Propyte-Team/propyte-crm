import { describe, it, expect } from "vitest";
import { evaluar } from "./evaluar";
import { MODELO_DEFAULT } from "./modelo";

const pasaTodo = {
  mayor_edad: "SI", acepta_comision: "SI", disponibilidad: "TIEMPO_COMPLETO",
  colchon_meses: "TRES_A_SEIS", plaza: "PDC", movilidad: "SI",
};

describe("evaluar", () => {
  it("APTO: pasa filtros y suma ≥ 65", () => {
    const r = evaluar({
      respuestas: { ...pasaTodo, experiencia_inmobiliaria: "MAS_DE_3_ANOS", cartera_clientes: "DE_10_A_50", experiencia_ventas: "CONSULTIVA_ALTO_VALOR", ingles: "CONVERSACIONAL", prospeccion_digital: "SI" },
      actitudPuntos: 10, cvRecibido: false, modelo: MODELO_DEFAULT,
    });
    // 25 + 14 + 15 + 10 + 5 + 10 = 79
    expect(r.puntaje).toBe(79);
    expect(r.resultado).toBe("APTO");
    expect(r.filtros).toEqual({ mayor_edad: "PASA", acepta_comision: "PASA", disponibilidad: "PASA", colchon_meses: "PASA", plaza: "PASA", movilidad: "PASA" });
    expect(r.motivo).toBeNull();
  });

  it("NO_APTO por filtro claro aunque el puntaje sea alto", () => {
    const r = evaluar({
      respuestas: { ...pasaTodo, movilidad: "NO", experiencia_inmobiliaria: "MAS_DE_3_ANOS", cartera_clientes: "MAS_50_O_INVERSIONISTAS", experiencia_ventas: "CONSULTIVA_ALTO_VALOR", ingles: "CONVERSACIONAL", prospeccion_digital: "SI" },
      actitudPuntos: 20, cvRecibido: true, modelo: MODELO_DEFAULT,
    });
    expect(r.puntaje).toBe(100);
    expect(r.resultado).toBe("NO_APTO");
    expect(r.motivo).toBe("filtro:movilidad");
  });

  it("REVISAR: un solo filtro ambiguo con puntaje ≥ apto", () => {
    const r = evaluar({
      respuestas: { ...pasaTodo, colchon_meses: "NO_SE", experiencia_inmobiliaria: "MAS_DE_3_ANOS", cartera_clientes: "MAS_50_O_INVERSIONISTAS", experiencia_ventas: "CONSULTIVA_ALTO_VALOR", ingles: "CONVERSACIONAL", prospeccion_digital: "SI" },
      actitudPuntos: 0, cvRecibido: false, modelo: MODELO_DEFAULT,
    });
    expect(r.filtros.colchon_meses).toBe("AMBIGUO");
    expect(r.resultado).toBe("REVISAR");
    expect(r.motivo).toBe("ambiguo:colchon_meses");
  });

  it("dos filtros ambiguos → NO_APTO", () => {
    const r = evaluar({
      respuestas: { ...pasaTodo, colchon_meses: "NO_SE", disponibilidad: "NO_SE", experiencia_inmobiliaria: "MAS_DE_3_ANOS", cartera_clientes: "MAS_50_O_INVERSIONISTAS", experiencia_ventas: "CONSULTIVA_ALTO_VALOR", ingles: "CONVERSACIONAL", prospeccion_digital: "SI" },
      actitudPuntos: 20, cvRecibido: true, modelo: MODELO_DEFAULT,
    });
    expect(r.resultado).toBe("NO_APTO");
  });

  it("REVISAR por banda media; NO_APTO por banda baja", () => {
    const medio = evaluar({ respuestas: { ...pasaTodo, experiencia_inmobiliaria: "DE_1_A_3_ANOS", cartera_clientes: "MENOS_10", experiencia_ventas: "OTRO_GIRO", ingles: "BASICO" }, actitudPuntos: 10, cvRecibido: false, modelo: MODELO_DEFAULT });
    expect(medio.puntaje).toBe(48);
    expect(medio.resultado).toBe("REVISAR");
    const bajo = evaluar({ respuestas: { ...pasaTodo }, actitudPuntos: 5, cvRecibido: false, modelo: MODELO_DEFAULT });
    expect(bajo.puntaje).toBe(5);
    expect(bajo.resultado).toBe("NO_APTO");
    expect(bajo.motivo).toBe("puntaje");
  });

  it("filtro sin respuesta cuenta como AMBIGUO", () => {
    const { plaza: _omit, ...sinPlaza } = pasaTodo;
    const r = evaluar({ respuestas: sinPlaza, actitudPuntos: 0, cvRecibido: false, modelo: MODELO_DEFAULT });
    expect(r.filtros.plaza).toBe("AMBIGUO");
  });

  it("actitud null no suma y lo marca en el desglose", () => {
    const r = evaluar({ respuestas: pasaTodo, actitudPuntos: null, cvRecibido: true, modelo: MODELO_DEFAULT });
    expect(r.desglose.actitud).toBeNull();
    expect(r.desglose.cv_recibido).toBe(5);
    expect(r.puntaje).toBe(5);
  });

  it("filtro desactivado en el modelo no elimina", () => {
    const modelo = { ...MODELO_DEFAULT, filtros: { ...MODELO_DEFAULT.filtros, movilidad: { ...MODELO_DEFAULT.filtros.movilidad, activo: false } } };
    const r = evaluar({ respuestas: { ...pasaTodo, movilidad: "NO" }, actitudPuntos: 20, cvRecibido: true, modelo });
    expect(r.filtros.movilidad).toBe("PASA");
  });

  it("la actitud se recorta a actitudMax", () => {
    const r = evaluar({ respuestas: pasaTodo, actitudPuntos: 50, cvRecibido: false, modelo: MODELO_DEFAULT });
    expect(r.desglose.actitud).toBe(20);
  });

  it("un filtro ambiguo con puntaje < apto → NO_APTO con motivo ambiguo", () => {
    const r = evaluar({
      respuestas: { ...pasaTodo, colchon_meses: "NO_SE", experiencia_inmobiliaria: "DE_1_A_3_ANOS", cartera_clientes: "MENOS_10" },
      actitudPuntos: 10, cvRecibido: false, modelo: MODELO_DEFAULT,
    });
    expect(r.puntaje).toBe(36);
    expect(r.resultado).toBe("NO_APTO");
    expect(r.motivo).toBe("ambiguo:colchon_meses");
  });

  it("valor desconocido en un puntuable suma 0", () => {
    const r = evaluar({ respuestas: { ...pasaTodo, ingles: "NATIVO" }, actitudPuntos: 0, cvRecibido: false, modelo: MODELO_DEFAULT });
    expect(r.desglose.ingles).toBe(0);
    expect(r.puntaje).toBe(0);
  });

  it("'constructor' como respuesta suma 0 y no produce NaN", () => {
    const r = evaluar({ respuestas: { ...pasaTodo, ingles: "constructor", cartera_clientes: "toString" }, actitudPuntos: 0, cvRecibido: false, modelo: MODELO_DEFAULT });
    expect(r.desglose.ingles).toBe(0);
    expect(r.desglose.cartera_clientes).toBe(0);
    expect(Number.isNaN(r.puntaje)).toBe(false);
    expect(r.puntaje).toBe(0);
  });

  it("dos ambiguos: motivo en orden canónico sin importar el orden de las respuestas", () => {
    const r = evaluar({
      respuestas: { colchon_meses: "NO_SE", disponibilidad: "NO_SE", mayor_edad: "SI", acepta_comision: "SI", plaza: "PDC", movilidad: "SI" },
      actitudPuntos: 0, cvRecibido: false, modelo: MODELO_DEFAULT,
    });
    expect(r.resultado).toBe("NO_APTO");
    expect(r.motivo).toBe("ambiguo:disponibilidad,colchon_meses");
  });

  it("REVISAR por banda lleva motivo 'puntaje'", () => {
    const r = evaluar({ respuestas: { ...pasaTodo, experiencia_inmobiliaria: "MAS_DE_3_ANOS", cartera_clientes: "DE_10_A_50" }, actitudPuntos: 5, cvRecibido: false, modelo: MODELO_DEFAULT });
    expect(r.puntaje).toBe(44);
    expect(r.resultado).toBe("REVISAR");
    expect(r.motivo).toBe("puntaje");
  });

  it("actitud no finita se trata como null", () => {
    const r = evaluar({ respuestas: pasaTodo, actitudPuntos: Number.NaN, cvRecibido: false, modelo: MODELO_DEFAULT });
    expect(r.desglose.actitud).toBeNull();
    expect(r.puntaje).toBe(0);
  });
});

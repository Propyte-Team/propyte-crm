import { describe, it, expect } from "vitest";
import {
  PASOS_EMBUDO, calcularEmbudo, esFuenteMasiva, pasoDeRegla, porcentajeAvance, mediana,
  type CambioDeEstado,
} from "./embudo";

const AHORA = new Date("2026-11-30T12:00:00Z");
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000);

function cambio(p: Partial<CambioDeEstado> & { contactId: string }): CambioDeEstado {
  return { desde: null, hasta: null, en: hace(1), source: "api", desdeEn: null, ...p };
}

describe("PASOS_EMBUDO", () => {
  it("son los 11 estados activos en orden, sin salidas ni especiales", () => {
    expect(PASOS_EMBUDO).toEqual([
      "NUEVO", "SIN_RESPUESTA", "CONTACTADO", "REUNION", "DEMO", "RECORRIDO",
      "PROPUESTA", "APARTADO", "FIRMA", "ESCRITURA", "POSTVENTA",
    ]);
  });
});

describe("esFuenteMasiva", () => {
  it("reconoce las cargas conocidas", () => {
    expect(esFuenteMasiva("estado_llenado_953")).toBe(true);
    expect(esFuenteMasiva("estado_migracion_958")).toBe(true);
    expect(esFuenteMasiva("operaciones_llenado_957")).toBe(true);
  });
  it("reconoce cualquier fuente con llenado o migración", () => {
    expect(esFuenteMasiva("otra_llenado_999")).toBe(true);
    expect(esFuenteMasiva("Migración_futura")).toBe(true);
  });
  it("no marca lo orgánico", () => {
    expect(esFuenteMasiva("api")).toBe(false);
    expect(esFuenteMasiva("ficha")).toBe(false);
    expect(esFuenteMasiva(null)).toBe(false);
  });
});

describe("pasoDeRegla", () => {
  const stage = (toStage?: string) => ({ triggerType: "STAGE_CHANGE", triggerConfig: toStage ? { toStage } : {} });
  it("etapas de negocio → estado equivalente", () => {
    expect(pasoDeRegla(stage("MEETING_COMPLETED"))).toBe("REUNION");
    expect(pasoDeRegla(stage("PROPOSAL_SENT"))).toBe("PROPUESTA");
    expect(pasoDeRegla(stage("NEGOTIATION"))).toBe("PROPUESTA");
    expect(pasoDeRegla(stage("RESERVED"))).toBe("APARTADO");
    expect(pasoDeRegla(stage("CONTRACT_SIGNED"))).toBe("FIRMA");
    expect(pasoDeRegla(stage("CLOSING"))).toBe("FIRMA");
    expect(pasoDeRegla(stage("WON"))).toBe("POSTVENTA");
  });
  it("cambio de etapa sin etapa o con una sin equivalente → en cualquier momento", () => {
    expect(pasoDeRegla(stage())).toBe("CUALQUIER_MOMENTO");
    expect(pasoDeRegla(stage("LOST"))).toBe("CUALQUIER_MOMENTO");
  });
  it("eventos, inactividad y tiempo → en cualquier momento", () => {
    expect(pasoDeRegla({ triggerType: "EVENT", triggerConfig: { eventType: "lead.captured" } })).toBe("CUALQUIER_MOMENTO");
    expect(pasoDeRegla({ triggerType: "INACTIVITY", triggerConfig: { hours: 48 } })).toBe("CUALQUIER_MOMENTO");
    expect(pasoDeRegla({ triggerType: "EVENT", triggerConfig: { toStage: "RESERVED" } })).toBe("CUALQUIER_MOMENTO");
  });
});

describe("porcentajeAvance / mediana", () => {
  it("sin porcentaje con menos de 5 entradas", () => {
    expect(porcentajeAvance(4, 4)).toBeNull();
    expect(porcentajeAvance(5, 2)).toBe(40);
    expect(porcentajeAvance(0, 0)).toBeNull();
  });
  it("mediana de pares, impares y vacío", () => {
    expect(mediana([])).toBeNull();
    expect(mediana([5, 1, 3])).toBe(3);
    expect(mediana([1, 2, 3, 10])).toBe(2.5);
  });
});

describe("calcularEmbudo", () => {
  const base = { conteosHoy: { NUEVO: 10, CONTACTADO: 4, PERDIDO: 2, DERIVADO_A_RH: 7, "": 3 }, ahora: AHORA, dias: 30 };
  const get = (e: ReturnType<typeof calcularEmbudo>, estado: string) => e.pasos.find((p) => p.estado === estado)!;

  it("devuelve un paso por estado activo con su conteo de hoy", () => {
    const e = calcularEmbudo({ ...base, cambios: [] });
    expect(e.pasos.map((p) => p.estado)).toEqual([...PASOS_EMBUDO]);
    expect(get(e, "NUEVO").hoy).toBe(10);
    expect(get(e, "DEMO").hoy).toBe(0);
    expect(e.porClasificar).toBe(3);
    expect(e.especiales.find((s) => s.estado === "DERIVADO_A_RH")!.hoy).toBe(7);
    expect(e.salidas.find((s) => s.estado === "PERDIDO")!.hoy).toBe(2);
  });

  it("cuenta entraron y avanzaron (un cambio posterior a un estado más adelante)", () => {
    const cambios = [
      cambio({ contactId: "a", desde: "NUEVO", hasta: "CONTACTADO", en: hace(10) }),
      cambio({ contactId: "a", desde: "CONTACTADO", hasta: "REUNION", en: hace(5) }),
      cambio({ contactId: "b", desde: "NUEVO", hasta: "CONTACTADO", en: hace(8) }),
      cambio({ contactId: "c", desde: "NUEVO", hasta: "CONTACTADO", en: hace(7) }),
      cambio({ contactId: "c", desde: "CONTACTADO", hasta: "SIN_RESPUESTA", en: hace(2) }), // atrás: no avanza
    ];
    const e = calcularEmbudo({ ...base, cambios });
    expect(get(e, "CONTACTADO").entraron).toBe(3);
    expect(get(e, "CONTACTADO").avanzaron).toBe(1);
    expect(get(e, "REUNION").entraron).toBe(1);
    expect(get(e, "SIN_RESPUESTA").entraron).toBe(1);
  });

  it("un cambio anterior a la entrada no cuenta como avance", () => {
    const cambios = [
      cambio({ contactId: "a", desde: "REUNION", hasta: "NUEVO", en: hace(10) }),
      cambio({ contactId: "a", desde: "NUEVO", hasta: "SIN_RESPUESTA", en: hace(9) }),
    ];
    const e = calcularEmbudo({ ...base, cambios });
    // Entró a Sin respuesta y salió hacia atrás/lado: nada adelante de Sin respuesta
    expect(get(e, "SIN_RESPUESTA").avanzaron).toBe(0);
    // Entró a Nuevo y luego pasó a Sin respuesta (más adelante)
    expect(get(e, "NUEVO").avanzaron).toBe(1);
  });

  it("excluye cargas masivas y cambios fuera de la ventana", () => {
    const cambios = [
      cambio({ contactId: "a", desde: null, hasta: "NUEVO", source: "estado_llenado_953", en: hace(3) }),
      cambio({ contactId: "b", desde: null, hasta: "NUEVO", source: "estado_migracion_958", en: hace(3) }),
      cambio({ contactId: "c", desde: null, hasta: "NUEVO", source: "operaciones_llenado_957", en: hace(3) }),
      cambio({ contactId: "d", desde: null, hasta: "NUEVO", en: hace(45) }),
      cambio({ contactId: "e", desde: null, hasta: "NUEVO", en: hace(3) }),
    ];
    expect(get(calcularEmbudo({ ...base, cambios }), "NUEVO").entraron).toBe(1);
    expect(get(calcularEmbudo({ ...base, cambios, dias: 90 }), "NUEVO").entraron).toBe(2);
  });

  it("mediana de días en el estado, solo con quienes salieron en la ventana y con muestra mínima", () => {
    const sale = (id: string, dias: number) =>
      cambio({ contactId: id, desde: "CONTACTADO", hasta: "REUNION", en: hace(1), desdeEn: hace(1 + dias) });
    // Con 9 salidas todavía no hay mediana (MIN_MUESTRA_MEDIANA = 10).
    const nueve = Array.from({ length: 9 }, (_, i) => sale(`p${i}`, 2));
    const pocos = calcularEmbudo({ ...base, cambios: nueve });
    expect(get(pocos, "CONTACTADO").medianaDias).toBeNull();
    expect(get(pocos, "CONTACTADO").muestraMediana).toBe(9);

    const diez = [...Array.from({ length: 5 }, (_, i) => sale(`a${i}`, 2)), ...Array.from({ length: 5 }, (_, i) => sale(`b${i}`, 6))];
    const e = calcularEmbudo({ ...base, cambios: diez });
    expect(get(e, "CONTACTADO").medianaDias).toBeCloseTo(4, 5);
  });

  it("con pocas salidas no marca atorados (prod: 3 salidas rápidas marcaban 219 de 220)", () => {
    const sale = (id: string) =>
      cambio({ contactId: id, desde: "NUEVO", hasta: "CONTACTADO", en: hace(1), desdeEn: hace(1.9) });
    const estancias = Array.from({ length: 5 }, (_, i) => ({ contactId: `n${i}`, estado: "NUEVO", desde: hace(30) }));
    const e = calcularEmbudo({ ...base, cambios: [sale("a"), sale("b"), sale("c")], estancias });
    expect(get(e, "NUEVO").medianaDias).toBeNull();
    expect(get(e, "NUEVO").atorados).toBe(0);
  });

  it("atorados: hoy en el estado desde hace más del doble de la mediana", () => {
    const sale = (id: string, dias: number) =>
      cambio({ contactId: id, desde: "CONTACTADO", hasta: "REUNION", en: hace(1), desdeEn: hace(1 + dias) });
    const cambios = Array.from({ length: 10 }, (_, i) => sale(`s${i}`, 3)); // mediana 3 → umbral 6
    const estancias = [
      { contactId: "x", estado: "CONTACTADO", desde: hace(7) },   // atorado
      { contactId: "y", estado: "CONTACTADO", desde: hace(5) },   // no
      { contactId: "z", estado: "NUEVO", desde: hace(100) },      // otro estado: no cuenta aquí
    ];
    const e = calcularEmbudo({ ...base, cambios, estancias });
    expect(get(e, "CONTACTADO").atorados).toBe(1);
    expect(get(e, "NUEVO").atorados).toBe(0); // sin mediana → 0
  });

  it("salidas y especiales: entraron y de qué paso salieron", () => {
    const cambios = [
      cambio({ contactId: "a", desde: "NUEVO", hasta: "PERDIDO", en: hace(2) }),
      cambio({ contactId: "b", desde: "NUEVO", hasta: "PERDIDO", en: hace(2) }),
      cambio({ contactId: "c", desde: "SIN_RESPUESTA", hasta: "PERDIDO", en: hace(2) }),
      cambio({ contactId: "d", desde: "DEMO", hasta: "NEGOCIO_PERDIDO", en: hace(2) }),
      cambio({ contactId: "e", desde: "NUEVO", hasta: "DERIVADO_A_RH", en: hace(2) }),
    ];
    const e = calcularEmbudo({ ...base, cambios });
    const perdido = e.salidas.find((s) => s.estado === "PERDIDO")!;
    expect(perdido.entraron).toBe(3);
    expect(perdido.desde).toEqual([{ estado: "NUEVO", n: 2 }, { estado: "SIN_RESPUESTA", n: 1 }]);
    expect(e.salidas.find((s) => s.estado === "NEGOCIO_PERDIDO")!.desde).toEqual([{ estado: "DEMO", n: 1 }]);
    expect(e.especiales.find((s) => s.estado === "DERIVADO_A_RH")!.entraron).toBe(1);
  });
});

describe("pasoDeRegla con eventos", () => {
  it("negocio ganado va a Postventa y visita completada a Reunión; otros eventos a cualquier momento", () => {
    expect(pasoDeRegla({ triggerType: "EVENT", triggerConfig: { eventType: "deal.won" } })).toBe("POSTVENTA");
    expect(pasoDeRegla({ triggerType: "EVENT", triggerConfig: { eventType: "visit.completed" } })).toBe("REUNION");
    expect(pasoDeRegla({ triggerType: "EVENT", triggerConfig: { eventType: "lead.captured" } })).toBe("CUALQUIER_MOMENTO");
  });
});

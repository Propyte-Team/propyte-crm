import { describe, expect, it } from "vitest";
import { ctxFalso, dbFalsa } from "./dobles.testutil";
import { pulso } from "./handlers/pulso";
import { PRACTICAS } from "./practicas.data";

/**
 * #655 — el SLA con denominador.
 *
 * `incumplidos_7d: 0` no significaba nada: la puerta contaba cuántos temporizadores se
 * pasaron de tiempo y nunca cuántos se midieron. Un cero se veía IDÉNTICO si el equipo
 * contestó todo a tiempo o si el reloj nunca se echó a andar — y es justo el número que
 * se usaría para decir que la atención va bien.
 */

type Sla = {
  temporizadores_7d: number;
  por_estado_7d: Record<string, number>;
  incumplidos_7d: number;
  proporcion_incumplidos_7d: number | null;
  vencidos_sin_marcar: number;
  nota: string;
};

function db(slaGrupos: Array<{ status: string; _count: { _all: number } }>) {
  return dbFalsa({
    conteos: {
      "contact.count": 7,
      "slaTimer.count": 0,
      "actionQueue.count": 0,
      "workflowEvent.count": 0,
    },
    secuencias: { "automationRule.count": [0, 8] },
    grupos: {
      "contact.groupBy": [],
      "deal.groupBy": [],
      "actionQueue.groupBy": [],
      "user.groupBy": [],
      "slaTimer.groupBy": slaGrupos,
    },
    listas: { "leadConnector.findMany": [] },
  });
}

const leerSla = async (grupos: Parameters<typeof db>[0]) =>
  ((await pulso({}, ctxFalso({ db: db(grupos) }))) as unknown as { sla: Sla }).sla;

describe("crm_pulso — el denominador del SLA", () => {
  it("emite el total del periodo y el desglose por estado", async () => {
    const sla = await leerSla([
      { status: "MET", _count: { _all: 8 } },
      { status: "BREACHED", _count: { _all: 2 } },
      { status: "RUNNING", _count: { _all: 1 } },
    ]);

    expect(sla.temporizadores_7d).toBe(11);
    expect(sla.por_estado_7d).toEqual({ MET: 8, BREACHED: 2, RUNNING: 1 });
    expect(sla.incumplidos_7d).toBe(2);
    expect(sla.proporcion_incumplidos_7d).toBe(0.182);
  });

  /**
   * El caso que motivó la tarjeta, y el único que de verdad importa: con cero
   * temporizadores creados, la respuesta tiene que DECIRLO. Servir `incumplidos_7d: 0` a
   * secas es servir un verde que nadie puede falsar.
   */
  it("con cero temporizadores lo dice en vez de servir un cero que se lee como verde", async () => {
    const sla = await leerSla([]);

    expect(sla.temporizadores_7d).toBe(0);
    expect(sla.incumplidos_7d).toBe(0);
    // Sin denominador no hay proporción: null, no 0. Un 0 aquí volvería a mentir.
    expect(sla.proporcion_incumplidos_7d).toBeNull();
    expect(sla.nota).toMatch(/CERO temporizadores/);
    expect(sla.nota).toMatch(/no se midió nada/);
  });

  it("cumplir todo y no medir nada ya NO producen la misma respuesta", async () => {
    const cumplioTodo = await leerSla([{ status: "MET", _count: { _all: 12 } }]);
    const nadaMedido = await leerSla([]);

    expect(cumplioTodo.incumplidos_7d).toBe(nadaMedido.incumplidos_7d); // los dos en 0…
    expect(cumplioTodo.temporizadores_7d).not.toBe(nadaMedido.temporizadores_7d); // …y distinguibles
    expect(cumplioTodo.proporcion_incumplidos_7d).toBe(0);
    expect(nadaMedido.proporcion_incumplidos_7d).toBeNull();
  });

  it("`vencidos_sin_marcar` sigue saliendo y la nota avisa que no está en los incumplidos", async () => {
    const sla = await leerSla([{ status: "RUNNING", _count: { _all: 3 } }]);

    expect(sla.vencidos_sin_marcar).toBe(0); // el conteo aparte, con su propio filtro
    expect(sla.nota).toMatch(/no está incluido en los incumplidos/);
  });

  /**
   * El catálogo de prácticas es lo que el auditor lee para decidir cómo medir. Si pide una
   * proporción que la puerta no puede dar, la práctica no se puede ejecutar.
   */
  it("la práctica sla-primera-respuesta ya se puede ejecutar con lo que devuelve la puerta", async () => {
    const practica = PRACTICAS.find((p) => p.id === "sla-primera-respuesta");
    expect(practica?.ya_existe_si).toMatch(/total de temporizadores del periodo/);
    // Y el `como_se_mide` ya manda leer el denominador, no solo el numerador.
    expect(practica?.como_se_mide).toMatch(/sla.temporizadores_7d/);

    const sla = await leerSla([
      { status: "MET", _count: { _all: 3 } },
      { status: "BREACHED", _count: { _all: 1 } },
    ]);
    // La proporción que pide la práctica, calculable sin salir de la respuesta.
    expect(sla.incumplidos_7d / sla.temporizadores_7d).toBe(0.25);
  });
});

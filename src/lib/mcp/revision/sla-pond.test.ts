import { describe, expect, it } from "vitest";
import { ctxFalso, dbFalsa } from "./dobles.testutil";
import { pulso } from "./handlers/pulso";

/**
 * #732 — el Pond fuera del denominador del cumplimiento.
 *
 * El Pond (#678) sella temporizadores ORPHAN cuando ningún asesor puede quedarse con un
 * lead. La puerta los agrupaba solo por `status`, así que se sumaban a los de atención:
 * un lead que nadie tomó podía acabar contando como atención cumplida. Con un solo
 * temporizador MET, el reporte publicaba 100% de cumplimiento y desde el reporte no había
 * forma de saber de cuál de los dos tipos era.
 */

type Sla = {
  temporizadores_7d: number;
  por_estado_7d: Record<string, number>;
  por_tipo_7d: Record<string, number>;
  incumplidos_7d: number;
  proporcion_incumplidos_7d: number | null;
  vencidos_sin_marcar: number;
  pond: {
    temporizadores_7d: number;
    por_estado_7d: Record<string, number>;
    proporcion_al_pond_7d: number | null;
  };
  nota: string;
};

type Grupo = { status: string; type: string; _count: { _all: number } };

function db(slaGrupos: Grupo[], leadsReales = 10) {
  return dbFalsa({
    conteos: {
      "contact.count": leadsReales,
      "slaTimer.count": 0,
      "actionQueue.count": 0,
      "workflowEvent.count": 0,
    },
    secuencias: { "automationRule.count": [0, 8] },
    grupos: {
      "contact.groupBy": [],
      "deal.groupBy": [],
      // #684: el acumulado real de fallos por conector sale del log de entregas,
      // no del contador de la fila (que se resetea en cada entrega buena).
      "connectorLeadLog.groupBy": [],
      "actionQueue.groupBy": [],
      "user.groupBy": [],
      "slaTimer.groupBy": slaGrupos,
    },
    listas: { "leadConnector.findMany": [] },
  });
}

const leerSla = async (grupos: Grupo[], leadsReales?: number) =>
  ((await pulso({}, ctxFalso({ db: db(grupos, leadsReales) }))) as unknown as { sla: Sla }).sla;

describe("crm_pulso — el Pond no entra al cumplimiento (#732)", () => {
  it("el caso real: un solo temporizador, y es del Pond", async () => {
    // Exactamente lo que la tarjeta reporta en producción: 1 temporizador, MET:1,
    // publicado como 100% de cumplimiento. Es del Pond: nadie atendió a nadie.
    const sla = await leerSla([{ status: "MET", type: "ORPHAN", _count: { _all: 1 } }]);

    expect(sla.temporizadores_7d).toBe(0);
    expect(sla.proporcion_incumplidos_7d).toBeNull();
    expect(sla.pond.temporizadores_7d).toBe(1);
    expect(sla.nota).toMatch(/CERO temporizadores DE ATENCIÓN/);
  });

  it("no mezcla los dos tipos en el denominador", async () => {
    const sla = await leerSla([
      { status: "MET", type: "FIRST_TOUCH", _count: { _all: 3 } },
      { status: "BREACHED", type: "FIRST_TOUCH", _count: { _all: 1 } },
      { status: "MET", type: "ORPHAN", _count: { _all: 6 } },
    ]);

    // Cumplimiento sobre 4 de atención, no sobre 10.
    expect(sla.temporizadores_7d).toBe(4);
    expect(sla.incumplidos_7d).toBe(1);
    expect(sla.proporcion_incumplidos_7d).toBe(0.25);

    // Con los ORPHAN dentro habría salido 1/10 = 0.1: la mitad de malo de lo que es.
    expect(sla.pond.temporizadores_7d).toBe(6);
    expect(sla.pond.por_estado_7d).toEqual({ MET: 6 });
  });

  it("suma los reintentos a la atención: también los debemos nosotros", async () => {
    const sla = await leerSla([
      { status: "MET", type: "FIRST_TOUCH", _count: { _all: 2 } },
      { status: "RUNNING", type: "RETRY", _count: { _all: 1 } },
    ]);

    expect(sla.temporizadores_7d).toBe(3);
    expect(sla.pond.temporizadores_7d).toBe(0);
  });

  it("publica qué proporción de leads reales cayó al Pond", async () => {
    // El segundo número que faltaba. Un cumplimiento perfecto con un tercio de los leads
    // sin dueño no es una buena semana.
    const sla = await leerSla(
      [
        { status: "MET", type: "FIRST_TOUCH", _count: { _all: 6 } },
        { status: "RUNNING", type: "ORPHAN", _count: { _all: 3 } },
      ],
      9,
    );

    expect(sla.proporcion_incumplidos_7d).toBe(0);
    expect(sla.pond.proporcion_al_pond_7d).toBe(0.333);
  });

  it("sin leads en la ventana la proporción es null, no cero", async () => {
    const sla = await leerSla([{ status: "RUNNING", type: "ORPHAN", _count: { _all: 2 } }], 0);

    expect(sla.pond.proporcion_al_pond_7d).toBeNull();
  });

  it("el desglose por tipo deja ver de qué está hecho el total", async () => {
    const sla = await leerSla([
      { status: "MET", type: "FIRST_TOUCH", _count: { _all: 2 } },
      { status: "BREACHED", type: "FIRST_TOUCH", _count: { _all: 1 } },
      { status: "MET", type: "ORPHAN", _count: { _all: 4 } },
    ]);

    expect(sla.por_tipo_7d).toEqual({ FIRST_TOUCH: 3, ORPHAN: 4 });
  });

  it("la nota advierte de leer los dos números juntos", async () => {
    const sla = await leerSla([{ status: "MET", type: "FIRST_TOUCH", _count: { _all: 1 } }]);

    expect(sla.nota).toMatch(/nunca entran al cumplimiento/);
    expect(sla.nota).toMatch(/problema de reparto/);
  });
});

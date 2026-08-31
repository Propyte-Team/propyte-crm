import { describe, expect, it } from "vitest";
import { AHORA, ctxFalso, dbFalsa } from "./dobles.testutil";
import { fallos } from "./handlers/fallos";
import { MAX_STEPS_AGOTADOS } from "@/lib/agents/run-status";

/**
 * #654 — una corrida de agente que se quedó sin pasos.
 *
 * Antes salía con status COMPLETED y `output` vacío, así que no entraba en `crm_fallos`
 * (que solo consulta FAILED) ni en ninguna otra categoría. El agente dejaba el trabajo a
 * medias y el tablero decía que todo salió bien.
 *
 * Ahora sale FAILED con una marca estable, y la puerta la separa de los errores duros:
 * piden cosas distintas —más pasos contra arreglar lo que reventó— y juntas la segunda se
 * pierde entre las primeras.
 */

const hace1h = new Date(AHORA.getTime() - 60 * 60 * 1000);

function db(corridas: Array<{ trigger: string; error: string | null }>) {
  return dbFalsa({
    listas: {
      "actionQueue.findMany": [],
      "connectorLeadLog.findMany": [],
      "agentRun.findMany": corridas.map((c) => ({ ...c, endedAt: hace1h })),
    },
    grupos: { "slaTimer.groupBy": [], "workflowEvent.groupBy": [] },
  });
}

type Salida = {
  agentes_fallidos: Array<{ firma: string; casos: number }>;
  agentes_sin_terminar: Array<{ firma: string; casos: number }>;
};

describe("crm_fallos y las corridas de agente sin terminar", () => {
  it("separa las agotadas de los errores duros", async () => {
    const r = (await fallos(
      {},
      ctxFalso({
        db: db([
          { trigger: "reactivacion", error: `${MAX_STEPS_AGOTADOS}: se acabaron los 8 pasos.` },
          { trigger: "reactivacion", error: `${MAX_STEPS_AGOTADOS}: se acabaron los 8 pasos.` },
          { trigger: "seguimiento", error: "Claude API 529: overloaded" },
        ]),
      }),
    )) as unknown as Salida;

    expect(r.agentes_sin_terminar).toHaveLength(1);
    expect(r.agentes_sin_terminar[0].casos).toBe(2);
    expect(r.agentes_sin_terminar[0].firma).toContain("reactivacion");

    expect(r.agentes_fallidos).toHaveLength(1);
    expect(r.agentes_fallidos[0].firma).toContain("seguimiento");
  });

  // El montón que se quería rescatar no debe llevarse por delante al que ya funcionaba.
  it("sin agotadas, los fallidos siguen saliendo igual y el montón nuevo queda vacío", async () => {
    const r = (await fallos(
      {},
      ctxFalso({ db: db([{ trigger: "seguimiento", error: "boom" }]) }),
    )) as unknown as Salida;

    expect(r.agentes_fallidos).toHaveLength(1);
    expect(r.agentes_sin_terminar).toEqual([]);
  });

  it("una corrida sin mensaje de error no se cuela como agotada", async () => {
    const r = (await fallos(
      {},
      ctxFalso({ db: db([{ trigger: "seguimiento", error: null }]) }),
    )) as unknown as Salida;

    expect(r.agentes_sin_terminar).toEqual([]);
    expect(r.agentes_fallidos).toHaveLength(1);
  });
});

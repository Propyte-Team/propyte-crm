import { describe, expect, it } from "vitest";
import { ctxFalso, dbFalsa } from "./dobles.testutil";
import { pulso } from "./handlers/pulso";

/**
 * #682 y #778 — dos consultas de `crm_pulso` que no filtraban `deletedAt: null` y por eso
 * contaban filas borradas lógicamente como si siguieran vivas. Es el mismo defecto que ya
 * se corrigió para `contact` (`realLeadWhere`), `automationRule`, `routingRule` y `user` en
 * este mismo archivo — aquí faltaba en `deal.groupBy` (#682) y en `leadConnector.findMany`
 * (#778).
 *
 * `dbFalsa` responde por clave `modelo.metodo` sin mirar el `where`: un doble así no puede
 * demostrar que el filtro funciona (eso lo prueba Prisma, no esta suite), pero si el
 * `capturarArgs` deja de ver `deletedAt: null` en el `where` de estas dos consultas, es
 * porque alguien lo quitó del handler — que es exactamente la regresión que estas pruebas
 * existen para atrapar.
 */

function dbCompleta(capturarArgs: (clave: string, args: unknown) => void) {
  return dbFalsa({
    capturarArgs,
    conteos: {
      "slaTimer.count": 0,
      "actionQueue.count": 0,
      "workflowEvent.count": 0,
    },
    secuencias: {
      "contact.count": [0, 0, 0, 0, 0, 0],
      "automationRule.count": [0, 0],
      "routingRule.count": [0, 0],
      "user.count": [0, 0],
    },
    grupos: {
      "contact.groupBy": [],
      "deal.groupBy": [],
      "connectorLeadLog.groupBy": [],
      "actionQueue.groupBy": [],
      "user.groupBy": [],
      "slaTimer.groupBy": [],
    },
    listas: { "leadConnector.findMany": [] },
  });
}

describe("crm_pulso — filtro de borrado lógico (#682, #778)", () => {
  it("#778 — `leadConnector.findMany` filtra `deletedAt: null`", async () => {
    const capturados: Record<string, unknown> = {};
    await pulso({}, ctxFalso({ db: dbCompleta((k, args) => { capturados[k] = args; }) }));

    expect(capturados["leadConnector.findMany"]).toMatchObject({
      where: { deletedAt: null },
    });
  });

  it("#682 — `deal.groupBy` filtra `deletedAt: null`", async () => {
    const capturados: Record<string, unknown> = {};
    await pulso({}, ctxFalso({ db: dbCompleta((k, args) => { capturados[k] = args; }) }));

    expect(capturados["deal.groupBy"]).toMatchObject({
      where: { deletedAt: null },
    });
  });
});

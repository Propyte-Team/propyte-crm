import { describe, expect, it } from "vitest";
import { ctxFalso, dbFalsa } from "./dobles.testutil";
import { pulso } from "./handlers/pulso";

/**
 * #684 — el contador de errores de conector medía una cosa y se publicaba con el nombre
 * de otra.
 *
 * `LeadConnector.errorCount` NO acumula: `markConnectorLead` lo pone en 0 en cada entrega
 * buena, así que su semántica real es «fallos seguidos desde la última entrega que salió
 * bien». La puerta lo publicaba como `errores_acumulados`, que es lo contrario. Con ese
 * nombre, un conector que pierde uno de cada dos leads se lee en CERO en cuanto el
 * siguiente entra bien, y en el panel se ve igual que uno perfecto.
 *
 * Ahora se publican dos números con el nombre que les corresponde: `fallos_seguidos`
 * (el contador de la fila, que responde «¿está caído AHORA?») y `fallos_historicos`
 * (el acumulado de verdad, contado sobre las filas ERROR del log de entregas).
 */

type Conector = {
  nombre: string;
  proveedor: string;
  fallos_seguidos: number;
  fallos_historicos: number;
  errores_acumulados?: unknown;
};

/** Un conector de webhook, que es la vía de los de Meta/Messenger. */
function conector(id: string, name: string, errorCount: number) {
  return {
    id,
    name,
    provider: "MESSENGER",
    status: "ACTIVE",
    lastSyncAt: null,
    lastLeadAt: new Date("2026-09-08T14:00:00.000Z"),
    errorCount,
  };
}

function db(
  conectores: ReturnType<typeof conector>[],
  fallosDelLog: Array<{ connectorId: string; _count: { _all: number } }>,
) {
  return dbFalsa({
    conteos: {
      "contact.count": 10,
      "slaTimer.count": 0,
      "actionQueue.count": 0,
      "workflowEvent.count": 0,
    },
    secuencias: { "automationRule.count": [0, 8] },
    grupos: {
      "contact.groupBy": [],
      "deal.groupBy": [],
      "connectorLeadLog.groupBy": fallosDelLog,
      "actionQueue.groupBy": [],
      "user.groupBy": [],
      "slaTimer.groupBy": [],
    },
    listas: { "leadConnector.findMany": conectores },
  });
}

const leerConectores = async (
  conectores: ReturnType<typeof conector>[],
  fallosDelLog: Array<{ connectorId: string; _count: { _all: number } }> = [],
) =>
  (
    (await pulso({}, ctxFalso({ db: db(conectores, fallosDelLog) }))) as unknown as {
      conectores: { lista: Conector[] };
    }
  ).conectores.lista;

describe("crm_pulso — salud de conectores (#684)", () => {
  it("el caso que la tarjeta describe: contador en cero con fallos en la historia", async () => {
    // Un conector que ha fallado 12 veces y cuya última entrega salió bien. Antes esto se
    // publicaba como `errores_acumulados: 0` y se leía igual que un conector perfecto.
    const [c] = await leerConectores(
      [conector("conn-1", "Messenger | DM Propyte", 0)],
      [{ connectorId: "conn-1", _count: { _all: 12 } }],
    );

    expect(c.fallos_seguidos).toBe(0);
    expect(c.fallos_historicos).toBe(12);
  });

  it("un conector caído AHORA se distingue de uno que falló y se recuperó", async () => {
    const lista = await leerConectores(
      [conector("caido", "Caído ahora", 5), conector("recuperado", "Se recuperó", 0)],
      [
        { connectorId: "caido", _count: { _all: 5 } },
        { connectorId: "recuperado", _count: { _all: 12 } },
      ],
    );

    const caido = lista.find((c) => c.nombre === "Caído ahora")!;
    const recuperado = lista.find((c) => c.nombre === "Se recuperó")!;

    // Los dos números juntos cuentan la historia completa, que es lo que ninguno solo hace:
    // el caído lleva 5 seguidos; el recuperado ha fallado más veces en total pero está bien.
    expect(caido.fallos_seguidos).toBe(5);
    expect(recuperado.fallos_seguidos).toBe(0);
    expect(recuperado.fallos_historicos).toBeGreaterThan(caido.fallos_historicos);
  });

  it("un conector sin ninguna fila de error publica cero, no undefined", async () => {
    // No aparecer en el groupBy es un 0 legítimo: nunca falló. Que saliera `undefined`
    // haría que el panel mostrara un hueco donde hay una respuesta.
    const [c] = await leerConectores([conector("limpio", "Nunca falló", 0)], []);

    expect(c.fallos_historicos).toBe(0);
    expect(c.fallos_seguidos).toBe(0);
  });

  it("el nombre viejo ya no se publica: prometía un acumulado que no era", async () => {
    const [c] = await leerConectores(
      [conector("conn-1", "Messenger | DM Propyte", 0)],
      [{ connectorId: "conn-1", _count: { _all: 3 } }],
    );

    expect(c.errores_acumulados).toBeUndefined();
  });

  it("los dos campos están en todas las filas de la lista", async () => {
    const lista = await leerConectores(
      [conector("a", "A", 0), conector("b", "B", 2), conector("c", "C", 0)],
      [{ connectorId: "b", _count: { _all: 2 } }],
    );

    expect(lista).toHaveLength(3);
    for (const c of lista) {
      expect(typeof c.fallos_seguidos, `${c.nombre} sin fallos_seguidos`).toBe("number");
      expect(typeof c.fallos_historicos, `${c.nombre} sin fallos_historicos`).toBe("number");
    }
  });
});

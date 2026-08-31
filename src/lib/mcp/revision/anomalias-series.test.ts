import { describe, expect, it } from "vitest";
import { AHORA, ctxFalso, dbFalsa } from "./dobles.testutil";
import { anomalias } from "./handlers/anomalias";
import { PRACTICAS } from "./practicas.data";

/**
 * #657 — las dos series que el catálogo pedía y la puerta no podía dar.
 *
 * La práctica `eventos-que-se-procesan` dice que la señal de alarma es que la cola de
 * trabajos pendientes CREZCA día con día, porque significa que el cron que los consume
 * dejó de correr. `crm_pulso` la servía como conteo puntual: cada día se comparaba contra
 * nada. Y de las corridas de agente no había serie de ninguna clase.
 */

const DIA = 24 * 60 * 60 * 1000;
/** El corte de hoy en el reloj de las pruebas (AHORA = 2026-08-28T15:00Z). */
const CORTE_HOY = new Date("2026-08-28T00:00:00.000Z");
/** Mediodía de hace `n` días completos. `n=1` es ayer, el día que se compara. */
const hace = (n: number) => new Date(CORTE_HOY.getTime() - n * DIA + 12 * 60 * 60 * 1000);

type Serie = {
  ultimo_dia_completo: number;
  mediana_13_dias_previos: number;
  desviacion: number;
  senal: string;
  nota?: string;
};

function db(over: {
  eventos?: Array<{ occurredAt: Date; processedAt: Date | null }>;
  corridas?: Array<{ startedAt: Date; status: string; output: string | null }>;
} = {}) {
  return dbFalsa({
    listas: {
      "contact.findMany": [],
      "deal.findMany": [],
      "actionQueue.findMany": [],
      "connectorLeadLog.findMany": [],
      "slaTimer.findMany": [],
      "workflowEvent.findMany": over.eventos ?? [],
      "agentRun.findMany": over.corridas ?? [],
    },
  });
}

const leer = async (over?: Parameters<typeof db>[0]) =>
  (await anomalias({}, ctxFalso({ db: db(over) }))) as unknown as {
    series: Record<string, Serie>;
    hoy_parcial: { conteos: Record<string, number> };
  };

describe("crm_anomalias — cola de eventos como serie", () => {
  it("la serie existe y se compara contra su propia mediana", async () => {
    const r = await leer();
    expect(r.series.eventos_sin_procesar).toBeDefined();
    expect(r.series.eventos_sin_procesar).toHaveProperty("mediana_13_dias_previos");
    expect(r.series.eventos_sin_procesar).toHaveProperty("senal");
  });

  /**
   * El caso que motiva la práctica: el cron dejó de correr y la cola se acumula. Con un
   * conteo puntual esto era invisible; con la serie sale marcado `alto`.
   */
  it("una cola que se acumula sale marcada alto", async () => {
    // 10 eventos de hace 3 días que nadie ha procesado: pesan en el backlog de todos los
    // cierres desde entonces, incluido el de ayer.
    const atascados = Array.from({ length: 10 }, () => ({ occurredAt: hace(3), processedAt: null }));
    const r = await leer({ eventos: atascados });

    expect(r.series.eventos_sin_procesar.ultimo_dia_completo).toBe(10);
    expect(r.series.eventos_sin_procesar.senal).toBe("alto");
  });

  /**
   * El control que hace que el caso anterior signifique algo: los mismos 10 eventos, pero
   * consumidos a los 5 minutos. Si esto también saliera `alto`, la serie estaría contando
   * el flujo de entrada y no la cola.
   */
  it("la misma carga, procesada a tiempo, NO dispara señal", async () => {
    const alDia = Array.from({ length: 10 }, () => ({
      occurredAt: hace(3),
      processedAt: new Date(hace(3).getTime() + 5 * 60 * 1000),
    }));
    const r = await leer({ eventos: alDia });

    expect(r.series.eventos_sin_procesar.ultimo_dia_completo).toBe(0);
    expect(r.series.eventos_sin_procesar.senal).not.toBe("alto");
  });

  /**
   * Un evento anterior a la ventana que sigue sin procesarse pesa en el backlog de HOY.
   * Filtrarlo por fecha de entrada haría que una cola atascada de hace un mes se viera
   * vacía, que es justo la lectura contraria a la verdadera.
   */
  it("un evento viejo sin procesar sigue contando", async () => {
    const r = await leer({
      eventos: [{ occurredAt: new Date("2026-06-01T10:00:00Z"), processedAt: null }],
    });
    expect(r.series.eventos_sin_procesar.ultimo_dia_completo).toBe(1);
    expect(r.hoy_parcial.conteos.eventos_sin_procesar).toBe(1);
  });

  it("declara que es un stock y que su cifra de hoy sí está completa", async () => {
    const r = await leer();
    expect(r.series.eventos_sin_procesar.nota).toMatch(/STOCK/);
    expect(r.series.eventos_sin_procesar.nota).toMatch(/backlog AHORA MISMO/);
  });
});

describe("crm_anomalias — corridas de agente", () => {
  const corrida = (dias: number, status: string, output: string | null) => ({
    startedAt: hace(dias),
    status,
    output,
  });

  it("trae total, fallidas y las cerradas sin conclusión", async () => {
    const r = await leer({
      corridas: [
        corrida(1, "COMPLETED", "Listo, contacté al lead."),
        corrida(1, "COMPLETED", null),
        corrida(1, "FAILED", null),
      ],
    });

    expect(r.series.corridas_de_agente.ultimo_dia_completo).toBe(3);
    expect(r.series.corridas_de_agente_fallidas.ultimo_dia_completo).toBe(1);
    expect(r.series.corridas_de_agente_sin_conclusion.ultimo_dia_completo).toBe(1);
  });

  /**
   * 🚨 El punto de la tarjeta: la serie detecta la corrida truncada por su PATRÓN
   * —cerrada como exitosa y con la salida vacía— sin depender de que el status sea el
   * correcto. Es la red que cubre el hueco de #654 aunque el enum nunca se migre.
   */
  it("una corrida COMPLETED con salida vacía se cuenta aunque el status mienta", async () => {
    const r = await leer({ corridas: [corrida(1, "COMPLETED", "   ")] });
    expect(r.series.corridas_de_agente_sin_conclusion.ultimo_dia_completo).toBe(1);
    expect(r.series.corridas_de_agente_fallidas.ultimo_dia_completo).toBe(0);
  });

  // Que los agentes dejen de dispararse no produce ningún error en ningún log.
  it("cero corridas es un dato, y sale en la serie", async () => {
    const r = await leer({ corridas: [] });
    expect(r.series.corridas_de_agente.ultimo_dia_completo).toBe(0);
  });
});

describe("las prácticas que pedían estas series", () => {
  it("`eventos-que-se-procesan` pide la tendencia que la puerta ya sirve", async () => {
    const practica = PRACTICAS.find((p) => p.id === "eventos-que-se-procesan");
    expect(practica?.como_se_mide).toMatch(/crezca día con día|crece día con día|crezca|crece/);

    const r = await leer();
    expect(Object.keys(r.series)).toContain("eventos_sin_procesar");
  });

  it("`automatizaciones-vivas` ya tiene con qué ver si los agentes siguen corriendo", async () => {
    expect(PRACTICAS.find((p) => p.id === "automatizaciones-vivas")).toBeDefined();
    const r = await leer();
    expect(Object.keys(r.series)).toContain("corridas_de_agente");
  });
});

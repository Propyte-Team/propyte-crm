import { describe, expect, it } from "vitest";
import { ctxFalso } from "./dobles.testutil";
import { protocolo } from "./handlers/protocolo";

/**
 * #60 (residuo) — con qué prioridad puede registrar el auditor.
 *
 * Las seis señales operativas que pedía la tarjeta original ya existen en `crm_pulso`, y el
 * tablero ya se llena solo. Lo único que faltaba era esta regla, que hasta ahora se cumplía
 * por criterio del agente y no por contrato: nada declaraba que la prioridad 1 estuviera
 * reservada a las personas.
 *
 * Una regla que solo vive en la costumbre se rompe el día que cambia el modelo, el prompt o
 * la persona — y se rompe en silencio, porque el tablero acepta el 1 sin chistar.
 */

type Paso = {
  n: number;
  nombre: string;
  prioridad?: { mapa: Record<string, number>; regla: string; por_que: string };
};

const leerPasos = async (): Promise<Paso[]> => {
  const r = (await protocolo({}, ctxFalso())) as unknown as { datos: { pasos: Paso[] } };
  return r.datos.pasos;
};

describe("crm_revision_protocolo — la prioridad con la que registra el auditor", () => {
  it("el paso de Registrar declara el mapa de severidad a prioridad", async () => {
    const registrar = (await leerPasos()).find((p) => p.nombre === "Registrar");

    expect(registrar?.prioridad?.mapa).toEqual({ critica: 2, alta: 2, media: 3, baja: 4 });
  });

  /**
   * El aserto que de verdad importa: ninguna severidad traduce a 1. Si alguien agrega un
   * tramo nuevo al mapa y lo mapea a 1, esto se rompe aquí y no en el tablero.
   */
  it("ninguna severidad del mapa llega a prioridad 1", async () => {
    const registrar = (await leerPasos()).find((p) => p.nombre === "Registrar");
    const destinos = Object.values(registrar?.prioridad?.mapa ?? {});

    expect(destinos.length).toBeGreaterThan(0); // el mapa existe: si no, esto no prueba nada
    expect(destinos).not.toContain(1);
  });

  it("la regla lo dice en palabras, no solo en el mapa", async () => {
    const registrar = (await leerPasos()).find((p) => p.nombre === "Registrar");

    // El auditor lee prosa, no solo estructuras: la regla tiene que ser legible tal cual.
    expect(registrar?.prioridad?.regla).toMatch(/NUNCA emite prioridad 1/);
    // Y el por qué, para que no se lea como una restricción arbitraria que conviene saltarse.
    expect(registrar?.prioridad?.por_que).toMatch(/personas/);
  });

  // Control: el resto del paso 5 sigue intacto. La regla se AÑADE, no sustituye nada.
  it("el paso de Registrar conserva su instrucción y su regla del 409", async () => {
    const registrar = (await leerPasos()).find((p) => p.nombre === "Registrar") as Paso & {
      hacer: string[];
      regla: string;
    };

    expect(registrar.hacer[0]).toContain("mejoras_create_task");
    expect(registrar.regla).toMatch(/409/);
  });
});

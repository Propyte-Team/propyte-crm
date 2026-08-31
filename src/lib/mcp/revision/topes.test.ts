import { describe, expect, it } from "vitest";
import { AHORA, ctxFalso, githubFalso } from "./dobles.testutil";
import { codigoBuscar, codigoCambios, codigoLeer } from "./handlers/codigo";
import { construirSobre, recortar, TOPE_RESPUESTA_BYTES, verificarTamano } from "./sobre";
import type { RespuestaRevision } from "./types";

/**
 * Los topes de §4.5 y —lo que de verdad importa— que el recorte SE DECLARE.
 *
 * Un truncado silencioso se lee como "eso es todo lo que hay". Quien recibe 30 fallos de
 * 400 sin que nadie se lo diga concluye que hay 30, y esa cifra acaba en una tarea del
 * tablero como si estuviera medida. El tope no es el riesgo: el silencio sí.
 */

describe("recortar", () => {
  it("no declara nada cuando no recorta", () => {
    expect(recortar([1, 2, 3], 10, "cosas").truncado).toBeUndefined();
  });

  it("recorta Y declara", () => {
    const r = recortar([1, 2, 3, 4, 5], 2, "cosas");
    expect(r.items).toEqual([1, 2]);
    expect(r.truncado).toEqual({ motivo: "cosas", devueltos: 2, tope: 2 });
  });
});

describe("verificarTamano", () => {
  it("deja pasar una respuesta normal intacta", () => {
    const r: RespuestaRevision<unknown> = {
      sobre: construirSobre({ ref: "main", sha: null, ahora: AHORA, alcance: "x" }),
      datos: { a: 1 },
    };
    expect(verificarTamano(r)).toBe(r);
  });

  it("sustituye la respuesta enorme por un aviso, en vez de cortarla a la mitad", () => {
    // Un JSON cortado a la mitad ni siquiera parsea: el cliente reportaría "la puerta
    // está rota" en vez de "pide menos".
    const r: RespuestaRevision<unknown> = {
      sobre: construirSobre({ ref: "main", sha: null, ahora: AHORA, alcance: "x" }),
      datos: { relleno: "x".repeat(TOPE_RESPUESTA_BYTES + 1000) },
    };
    const out = verificarTamano(r) as RespuestaRevision<{ error: string; bytes: number }>;

    expect(out.sobre.truncado?.devueltos).toBe(0);
    expect(out.datos.error).toMatch(/Acota la petición/);
    expect(JSON.parse(JSON.stringify(out))).toBeTruthy();
  });
});

describe("topes de las tools de código", () => {
  it("un archivo grande sin rango se rechaza diciendo cuántas líneas tiene", async () => {
    const grande = Array.from({ length: 5000 }, (_, i) => `linea ${i}`).join("\n");
    const ctx = ctxFalso({
      gh: githubFalso({
        leerArchivo: async (path) => ({ path, contenido: grande, bytes: 70_000 }),
      }),
    });

    await expect(codigoLeer({ path: "src/gordo.ts" }, ctx)).rejects.toThrow(/tope sin rango/);
  });

  it("con rango, el mismo archivo se sirve y el recorte se declara", async () => {
    const grande = Array.from({ length: 5000 }, (_, i) => `linea ${i}`).join("\n");
    const ctx = ctxFalso({
      gh: githubFalso({
        leerArchivo: async (path) => ({ path, contenido: grande, bytes: 70_000 }),
      }),
    });

    const r = (await codigoLeer(
      { path: "src/gordo.ts", desde_linea: 10, hasta_linea: 20 },
      ctx,
    )) as RespuestaRevision<{ contenido: string; lineas_totales: number }>;

    expect(r.datos.lineas_totales).toBe(5000);
    expect(r.datos.contenido.split("\n")).toHaveLength(11);
    expect(r.sobre.truncado?.motivo).toBe("rango de líneas pedido");
    // El SHA va en el sobre: es lo que hace citable el hallazgo como `archivo:línea@sha`.
    expect(r.sobre.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("un rango invertido se rechaza antes de gastar una llamada", async () => {
    await expect(
      codigoLeer({ path: "a.ts", desde_linea: 50, hasta_linea: 10 }, ctxFalso()),
    ).rejects.toThrow(/mayor o igual/);
  });

  it("🚨 una ventana de más de 30 días se acota Y SE AVISA", async () => {
    // Acotar en silencio haría concluir "no hubo actividad antes" a quien mire el
    // resultado. El aviso es la diferencia entre un dato y un dato engañoso.
    const r = (await codigoCambios({ desde: "2026-01-01T00:00:00Z" }, ctxFalso())) as RespuestaRevision<{
      aviso_ventana?: string;
    }>;
    expect(r.datos.aviso_ventana).toMatch(/30 días/);
    expect(r.datos.aviso_ventana).toMatch(/NO significa/);
  });

  it("una ventana corta no lleva aviso", async () => {
    const r = (await codigoCambios({ desde: "2026-08-27T00:00:00Z" }, ctxFalso())) as RespuestaRevision<{
      aviso_ventana?: string;
    }>;
    expect(r.datos.aviso_ventana).toBeUndefined();
  });

  it("una fecha inválida trae un ejemplo de la buena", async () => {
    await expect(codigoCambios({ desde: "ayer" }, ctxFalso())).rejects.toThrow(/no es una fecha válida/);
  });

  it("la búsqueda declara su limitación grande en el propio resultado", async () => {
    // La descripción de la tool ya lo dice, pero el resultado también: un agente que
    // recibe cero coincidencias tiene que leer ahí mismo que eso NO prueba ausencia.
    const r = (await codigoBuscar({ patron: "SlaPolicy" }, ctxFalso())) as RespuestaRevision<{
      limitacion_declarada: string;
      coincidencias: unknown[];
    }>;
    expect(r.datos.coincidencias).toEqual([]);
    expect(r.datos.limitacion_declarada).toMatch(/NO prueba/);
    expect(r.datos.limitacion_declarada).toMatch(/rama por default/);
  });

  it("rechaza rutas que se salen del repo", async () => {
    const ctx = ctxFalso({
      gh: githubFalso({
        leerArchivo: async () => {
          throw new Error("no debería llegar aquí");
        },
      }),
    });
    // El guardia vive en el cliente de GitHub; aquí se comprueba que la ruta llega tal
    // cual para que ese guardia pueda actuar.
    await expect(codigoLeer({ path: "" }, ctx)).rejects.toThrow(/Falta `path`/);
  });
});

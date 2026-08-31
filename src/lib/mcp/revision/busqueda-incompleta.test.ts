import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AHORA, ctxFalso, githubFalso } from "./dobles.testutil";
import { crearGithubReader } from "./github";
import { codigoBuscar } from "./handlers/codigo";
import { PRACTICAS } from "./practicas.data";
import type { RespuestaRevision } from "./types";

/**
 * #662 — la búsqueda devolvía «cero coincidencias» cuando GitHub no había contestado.
 *
 * Medido el 2026-08-31 contra este mismo repo, que es PÚBLICO y no está archivado:
 * `q=export repo:Propyte-Team/propyte-crm` respondía HTTP 200 con `total_count: 0` e
 * `incomplete_results: true`, en 5 de 5 corridas. El mismo endpoint contra un repo público
 * grande devolvía 662 coincidencias con `incomplete_results: false`, así que ni la
 * credencial ni la consulta estaban mal: GitHub abandona el índice de este repo.
 *
 * El defecto del código no es que GitHub falle —eso no lo controlamos— sino que un
 * «no te contesté» se sirviera con la misma forma que un «no existe». La propia
 * `limitacion_declarada` de la tool dice que un vacío no prueba ausencia, lo que convierte
 * el vacío en una respuesta de aspecto normal. Es la máquina exacta del hallazgo falso
 * «esto no está en el código», que este repo declara haber pagado cuatro veces.
 */

function respuestaGithub(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => "",
  };
}

beforeEach(() => {
  process.env.GITHUB_REVISION_PAT = "pat_de_prueba";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_REVISION_PAT;
});

describe("crearGithubReader().buscar", () => {
  it("🚨 cero resultados + búsqueda incompleta LANZA en vez de devolver lista vacía", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respuestaGithub({ total_count: 0, incomplete_results: true, items: [] })),
    );

    await expect(crearGithubReader().buscar("export", undefined, "sha", 30)).rejects.toThrow(
      /no completó la búsqueda/i,
    );
  });

  /**
   * El control que hace que el caso anterior signifique algo: un vacío HONESTO —GitHub
   * recorrió el índice entero y no había nada— sigue siendo una respuesta válida y no debe
   * convertirse en error. Si esto se rompiera, la tool empezaría a fallar cada vez que la
   * respuesta correcta es «no existe».
   */
  it("cero resultados con la búsqueda COMPLETA devuelve vacío, no error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respuestaGithub({ total_count: 0, incomplete_results: false, items: [] })),
    );

    const r = await crearGithubReader().buscar("xyzzy", undefined, "sha", 30);
    expect(r).toEqual({ coincidencias: [], incompleta: false });
  });

  it("resultados parciales se devuelven, marcados como incompletos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        respuestaGithub({
          total_count: 1,
          incomplete_results: true,
          items: [{ path: "src/a.ts", text_matches: [{ fragment: "export const a = 1" }] }],
        }),
      ),
    );

    const r = await crearGithubReader().buscar("export", undefined, "sha", 30);
    expect(r.incompleta).toBe(true);
    expect(r.coincidencias).toEqual([{ path: "src/a.ts", linea: 0, texto: "export const a = 1" }]);
  });

  /**
   * Sin el accept de `text-match` la API no manda `text_matches`, así que la rama que
   * reporta «línea 0, texto vacío» era la ÚNICA que se tomaba nunca: cada coincidencia
   * salía sin el fragmento que la hace útil.
   */
  it("pide los fragmentos con el accept de text-match", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respuestaGithub({ total_count: 0, incomplete_results: false, items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await crearGithubReader().buscar("export", undefined, "sha", 30);

    expect(fetchMock.mock.calls[0][1].headers.accept).toBe("application/vnd.github.text-match+json");
  });
});

describe("crm_codigo_buscar declara cuando la lista viene a medias", () => {
  const ctx = (incompleta: boolean, coincidencias: Array<{ path: string; linea: number; texto: string }>) =>
    ctxFalso({ gh: githubFalso({ buscar: async () => ({ coincidencias, incompleta }) }) });

  it("con la búsqueda incompleta, avisa que la ausencia no prueba nada", async () => {
    const r = (await codigoBuscar(
      { patron: "algo" },
      ctx(true, [{ path: "src/a.ts", linea: 0, texto: "algo" }]),
    )) as RespuestaRevision<{ advertencia_resultado_parcial?: string }>;

    expect(r.datos.advertencia_resultado_parcial).toMatch(/INCOMPLETA/);
    expect(r.datos.advertencia_resultado_parcial).toMatch(/no está completa/);
  });

  // Un campo que aparece siempre se ignora; uno que aparece a veces se lee.
  it("con la búsqueda completa, el campo NO se emite", async () => {
    const r = (await codigoBuscar(
      { patron: "algo" },
      ctx(false, [{ path: "src/a.ts", linea: 0, texto: "algo" }]),
    )) as RespuestaRevision<Record<string, unknown>>;

    expect(Object.keys(r.datos)).not.toContain("advertencia_resultado_parcial");
    expect(r.sobre.medido_en).toBe(AHORA.toISOString());
  });
});

describe("el catálogo no manda a medir con una herramienta que no responde", () => {
  /**
   * Cinco prácticas tenían a `crm_codigo_buscar` como único `como_se_mide`, así que hoy no
   * se podían medir. Este guardia es temporal por diseño: si el índice de GitHub revive,
   * se puede volver — pero midiéndolo antes, no por costumbre.
   */
  it("ninguna práctica se mide con crm_codigo_buscar", () => {
    const culpables = PRACTICAS.filter((p) => p.como_se_mide.includes("crm_codigo_buscar"));
    expect(culpables.map((p) => p.id)).toEqual([]);
  });

  it("las cinco que dependían de él ahora nombran una ruta que sí lee el repo", () => {
    const afectadas = [
      "lead-sin-dueno",
      "dedup-por-telefono-y-correo",
      "cadencia-de-seguimiento",
      "inventario-sin-vender-lo-vendido",
      "metas-con-linea-base",
    ];
    for (const id of afectadas) {
      const p = PRACTICAS.find((x) => x.id === id);
      expect(p, `no existe la práctica ${id}`).toBeDefined();
      expect(p!.como_se_mide, `${id} sin ruta de medición`).toMatch(/crm_codigo_leer|crm_anomalias|crm_pulso/);
    }
  });
});

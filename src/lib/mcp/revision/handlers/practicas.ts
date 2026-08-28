import { badRequest } from "../errors";
import { PRACTICAS, type Area } from "../practicas.data";
import { construirSobre, envolver } from "../sobre";
import type { RevisionContext } from "../types";

const AREAS: Area[] = [
  "velocidad",
  "calidad_lead",
  "pipeline",
  "seguimiento",
  "inventario",
  "reportes",
  "adopcion",
];

const POR_DIA = 2;

/**
 * `crm_practicas` — el catálogo, con dos sugeridas para hoy.
 *
 * LA ROTACIÓN ES DEL SERVIDOR, NO DEL AGENTE, y esa es una decisión con motivo. Un
 * revisor al que se le pide "elige una práctica" elige la primera de la lista, todos los
 * días, porque nada en su contexto distingue el martes del miércoles. El resultado sería
 * un catálogo de doce entradas del que solo se mide una.
 *
 * La rotación depende del día del calendario, así que dos corridas del mismo día ven lo
 * mismo —una reanudación no se salta la práctica del día— y el ciclo recorre las doce
 * antes de repetir.
 */
function sugeridasDe(ahora: Date): string[] {
  const diaEpoch = Math.floor(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()) / 86_400_000);
  const total = PRACTICAS.length;
  const out: string[] = [];
  for (let i = 0; i < Math.min(POR_DIA, total); i++) {
    out.push(PRACTICAS[(diaEpoch * POR_DIA + i) % total].id);
  }
  return out;
}

export async function practicas(args: unknown, ctx: RevisionContext) {
  const a = (args ?? {}) as { area?: unknown };

  let filtradas = PRACTICAS;
  if (a.area !== undefined) {
    if (typeof a.area !== "string" || !AREAS.includes(a.area as Area)) {
      throw badRequest(`\`area\` desconocida: "${String(a.area)}".`, { areas_validas: AREAS });
    }
    filtradas = PRACTICAS.filter((p) => p.area === a.area);
  }

  return envolver(
    construirSobre({
      ref: "catálogo versionado en el repo",
      sha: null,
      ahora: ctx.ahora,
      alcance: a.area ? `prácticas del área "${String(a.area)}"` : "catálogo completo",
    }),
    {
      /**
       * Las que le tocan a la corrida de hoy. Medir DOS y bien es mejor que enumerar doce
       * sin cifra: una propuesta sin medición no se puede registrar (paso 4 del protocolo).
       */
      sugeridas_hoy: sugeridasDe(ctx.ahora),
      areas: AREAS,
      practicas: filtradas,
      como_usarlas:
        "Toma las de `sugeridas_hoy`, mídelas con lo que dice su `como_se_mide` y revisa antes su " +
        "`ya_existe_si`. Si el CRM ya la cumple, la corrida no crea tarea: eso también es un " +
        "resultado. Si no la cumple, la tarea lleva la cifra que lo demuestra.",
    },
  );
}

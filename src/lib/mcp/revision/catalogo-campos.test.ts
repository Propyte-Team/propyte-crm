import { describe, expect, it } from "vitest";
import { ctxFalso, dbFalsa } from "./dobles.testutil";
import { anomalias } from "./handlers/anomalias";
import { pulso } from "./handlers/pulso";
import { FASE_DEL_PROYECTO, HECHOS_DECLARADOS } from "./contexto.data";
import { PRACTICAS } from "./practicas.data";

/**
 * #658 — el candado que faltaba: que el catálogo no cite campos inexistentes.
 *
 * El catálogo de prácticas y los hechos declarados son lo que el auditor LEE para decidir
 * cómo medir. Cuando el PR #22 renombró el bloque de leads de `nuevos_*` a
 * `reales_*`/`crudos_*`, el catálogo se quedó con los nombres viejos: tres prácticas
 * mandaban a consultar `leads.nuevos_7d` y `series.contactos_nuevos`, que ya no existían.
 *
 * Quien siga esa instrucción al pie de la letra busca un dato que no está y puede concluir
 * que el sistema no lo mide, cuando sí lo mide con otro nombre. Es exactamente el tipo de
 * hallazgo falso que el protocolo dice que ya costó cuatro veces.
 *
 * Esta prueba no revisa una lista de nombres a mano: extrae las citas del texto y las
 * compara contra las claves que los handlers emiten de verdad. Así el siguiente renombrado
 * rompe aquí y no en el reporte de alguien.
 */

/**
 * Bloques cuyas claves son VALORES del negocio y no nombres de campo (etapas del pipeline,
 * roles). Citar uno de sus miembros no es citar un campo del contrato, así que no se
 * valida: con dobles vienen vacíos y cualquier cita se leería como rota.
 */
const MAPAS_DE_VALORES = new Set(["deals_por_etapa", "usuarios_activos", "por_origen_7d", "por_estado_7d"]);

/**
 * Una cita es `<bloque>.<campo>`, con `<campo>` opcionalmente terminado en `*` para citar
 * una familia (`leads.reales_*`). El lookbehind descarta rutas de archivo: en
 * `src/lib/leads/real-leads.ts` no hay ninguna cita, aunque «leads.ts» lo parezca.
 *
 * 🚨 El backtick NO va en el lookbehind. Meterlo parece razonable —son delimitadores de
 * código— y deja ciego al candado justo donde más se cita: la mitad del catálogo escribe
 * sus campos entre backticks. Con el backtick excluido, este candado no habría detectado
 * la cita rota de `contexto.data.ts`, que es una de las cuatro que lo motivaron.
 */
const CITA = /(?<![\w/.\-])([a-z][a-z_0-9]*)\.([a-z][a-z_0-9]*\*?)/g;

/** Todo el texto del catálogo, sin importar en qué campo del objeto viva. */
function textos(valor: unknown, acc: string[] = []): string[] {
  if (typeof valor === "string") acc.push(valor);
  else if (Array.isArray(valor)) for (const v of valor) textos(v, acc);
  else if (valor && typeof valor === "object") for (const v of Object.values(valor)) textos(v, acc);
  return acc;
}

const db = () =>
  dbFalsa({
    conteos: {
      "contact.count": 0,
      "slaTimer.count": 0,
      "actionQueue.count": 0,
      "workflowEvent.count": 0,
    },
    secuencias: { "automationRule.count": [0, 0] },
    grupos: {
      "contact.groupBy": [],
      "deal.groupBy": [],
      "actionQueue.groupBy": [],
      "user.groupBy": [],
      "slaTimer.groupBy": [],
    },
    listas: {
      "leadConnector.findMany": [],
      "contact.findMany": [],
      "deal.findMany": [],
      "actionQueue.findMany": [],
      "connectorLeadLog.findMany": [],
      "slaTimer.findMany": [],
      "workflowEvent.findMany": [],
      "agentRun.findMany": [],
    },
  });

/** `bloque` → claves que ese bloque emite de verdad. */
async function contratoVivo(): Promise<Map<string, Set<string>>> {
  const p = (await pulso({}, ctxFalso({ db: db() }))) as Record<string, unknown>;
  const a = (await anomalias({}, ctxFalso({ db: db() }))) as Record<string, unknown>;

  const contrato = new Map<string, Set<string>>();
  for (const [bloque, valor] of Object.entries(p)) {
    if (valor && typeof valor === "object" && !Array.isArray(valor)) {
      contrato.set(bloque, new Set(Object.keys(valor)));
    }
  }
  contrato.set("series", new Set(Object.keys(a.series as object)));
  return contrato;
}

describe("el catálogo solo cita campos que la puerta emite", () => {
  it("ninguna práctica ni hecho declarado nombra una clave inexistente", async () => {
    const contrato = await contratoVivo();
    const rotas: string[] = [];

    for (const texto of textos([PRACTICAS, HECHOS_DECLARADOS, FASE_DEL_PROYECTO])) {
      for (const [, bloque, campo] of texto.matchAll(CITA)) {
        const claves = contrato.get(bloque);
        if (!claves || MAPAS_DE_VALORES.has(bloque)) continue;

        const existe = campo.endsWith("*")
          ? [...claves].some((k) => k.startsWith(campo.slice(0, -1)))
          : claves.has(campo);
        if (!existe) rotas.push(`${bloque}.${campo}`);
      }
    }

    expect(rotas, `citas a campos que no existen: ${rotas.join(", ")}`).toEqual([]);
  });

  /**
   * El control negativo de la prueba anterior. Sin él, un cambio que rompa el extractor
   * —una regex que deje de casar, un contrato que salga vacío— dejaría la prueba en verde
   * sin revisar una sola cita, que es la forma más común de que un candado deje de serlo.
   */
  it("el candado SÍ detecta una cita rota", async () => {
    const contrato = await contratoVivo();
    const inventada = "Contrastar con crm_pulso() → leads.nuevos_7d para la línea base.";

    const detectadas = [...inventada.matchAll(CITA)].filter(([, bloque, campo]) => {
      const claves = contrato.get(bloque);
      return claves && !MAPAS_DE_VALORES.has(bloque) && !claves.has(campo);
    });

    expect(detectadas.map(([m]) => m)).toEqual(["leads.nuevos_7d"]);
  });

  // El otro lado del control: una cita buena no debe salir marcada.
  it("una cita válida no se marca", async () => {
    const contrato = await contratoVivo();
    const buena = "crm_pulso() → leads.reales_7d y sla.incumplidos_7d.";

    const rotas = [...buena.matchAll(CITA)].filter(([, bloque, campo]) => {
      const claves = contrato.get(bloque);
      return claves && !MAPAS_DE_VALORES.has(bloque) && !claves.has(campo);
    });

    expect(rotas).toEqual([]);
  });

  // Sin esto, un contrato vacío haría pasar la prueba principal sin comprobar nada.
  it("el contrato leído de los handlers no viene vacío", async () => {
    const contrato = await contratoVivo();
    expect(contrato.get("leads")).toContain("reales_7d");
    expect(contrato.get("sla")).toContain("incumplidos_7d");
    expect(contrato.get("series")).toContain("leads_reales_nuevos");
  });
});

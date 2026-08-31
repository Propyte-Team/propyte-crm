import { anomalias } from "./handlers/anomalias";
import { codigoArbol, codigoBuscar, codigoCambios, codigoLeer } from "./handlers/codigo";
import { fallos } from "./handlers/fallos";
import { practicas } from "./handlers/practicas";
import { protocolo } from "./handlers/protocolo";
import { pulso } from "./handlers/pulso";
import { construirSobre, envolver, verificarTamano } from "./sobre";
import type { RespuestaRevision, RevisionContext, RevisionTool } from "./types";

/**
 * El catálogo de la puerta de revisión.
 *
 * LAS DESCRIPCIONES SON EL PRODUCTO, no documentación. Junto con el nombre y el schema son
 * TODO lo que el cliente ve, y pesan más en el comportamiento del agente que la
 * implementación. Cada una sigue el mismo contrato de cuatro partes:
 *
 *   intención en una frase · cuándo usarla · un ejemplo concreto · una limitación declarada
 *
 * La cuarta parte es la que más ahorra. Una tool sin límite declarado se elige para lo que
 * no puede, falla, y el agente no sabe si el problema es su input o la herramienta.
 *
 * `readOnlyHint: true` va en las nueve. Es la promesa "no escribo" hecha visible en el
 * handshake; si viviera solo en un test, el cliente no podría verla.
 */

const SOLO_LECTURA = { readOnlyHint: true } as const;

/** Envuelve un handler de base de datos en el sobre de rotulado. */
function conSobre(
  alcance: string,
  fn: (args: unknown, ctx: RevisionContext) => Promise<unknown>,
) {
  return async (args: unknown, ctx: RevisionContext) => {
    const datos = await fn(args, ctx);
    return verificarTamano(
      envolver(
        // `sha: null` porque estas tools no consultan el repo. Decirlo explícitamente evita
        // que un hallazgo de datos se cite con el SHA de otra llamada, que sería falso.
        construirSobre({ ref: "base de datos en vivo", sha: null, ahora: ctx.ahora, alcance }),
        datos,
      ),
    );
  };
}

/** Los handlers de código y catálogo ya arman su propio sobre; solo se verifica el tamaño. */
function yaEnvuelto(fn: (args: unknown, ctx: RevisionContext) => Promise<unknown>) {
  return async (args: unknown, ctx: RevisionContext) =>
    verificarTamano((await fn(args, ctx)) as RespuestaRevision<unknown>);
}

const SIN_ARGS = { type: "object", properties: {}, additionalProperties: false } as const;

const REF = {
  type: "string",
  description:
    "Rama, tag o SHA. Default `main`. Se resuelve a un SHA que viaja en el sobre de la respuesta.",
} as const;

export const REVISION_TOOLS: RevisionTool[] = [
  {
    name: "crm_revision_protocolo",
    description:
      "Devuelve el checklist de la revisión diaria del CRM: qué consultar, en qué orden, qué exige cada hallazgo antes de registrarse y cuándo NO crear tarea. " +
      "Úsala como PRIMERA llamada de cada corrida, antes de mirar ningún dato: los pasos 1, 2 y 4 evitan fallos que ya costaron hallazgos falsos y tareas duplicadas. " +
      'Ejemplo: {} — no recibe argumentos. ' +
      "No consulta el repo ni la base: es el procedimiento, no el estado, así que su sobre trae `sha: null`.",
    inputSchema: SIN_ARGS,
    annotations: { ...SOLO_LECTURA, title: "Protocolo de la revisión diaria" },
    handler: yaEnvuelto(protocolo),
  },
  {
    name: "crm_codigo_cambios",
    description:
      "Commits de una ventana de tiempo y pull requests abiertos del repositorio del CRM. " +
      "Úsala al arrancar la corrida para responder «qué cambió desde ayer» y decidir qué código vale la pena leer. " +
      'Ejemplo: {"desde": "2026-08-27T00:00:00Z"}. ' +
      "Tope: 50 commits y ventana máxima de 30 días —una ventana mayor se acota y el aviso viene en la respuesta—. NO devuelve los archivos tocados por cada commit: para eso lee el archivo con crm_codigo_leer.",
    inputSchema: {
      type: "object",
      properties: {
        desde: {
          type: "string",
          description: "Fecha ISO de inicio. Default: hace 24 horas.",
        },
        ref: REF,
      },
      additionalProperties: false,
    },
    annotations: { ...SOLO_LECTURA, title: "Cambios recientes del repo" },
    handler: yaEnvuelto(codigoCambios),
  },
  {
    name: "crm_codigo_arbol",
    description:
      "Lista el contenido de un directorio del repositorio en una ref dada. " +
      "Úsala para orientarte antes de leer, en vez de adivinar rutas: una ruta inventada gasta una llamada y devuelve 404. " +
      'Ejemplo: {"path": "src/lib/mcp"}. ' +
      "Es de un solo nivel, no recursiva: para bajar, vuelve a llamarla con el subdirectorio.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directorio. Vacío o ausente = raíz del repo." },
        ref: REF,
      },
      additionalProperties: false,
    },
    annotations: { ...SOLO_LECTURA, title: "Árbol del repo" },
    handler: yaEnvuelto(codigoArbol),
  },
  {
    name: "crm_codigo_leer",
    description:
      "Devuelve el contenido de un archivo del repositorio, con el SHA de la ref en el sobre. " +
      "Úsala para verificar un hallazgo antes de registrarlo: la cita que exige el protocolo se arma con `archivo:línea@sha` y sale de aquí. " +
      'Ejemplo: {"path": "src/lib/mcp/revision/auth.ts", "desde_linea": 40, "hasta_linea": 90}. ' +
      "Tope: 60 KB sin rango de líneas; un archivo mayor exige `desde_linea`/`hasta_linea` y responde 400 explicando cuántas líneas tiene.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ruta del archivo desde la raíz del repo." },
        desde_linea: { type: "integer", minimum: 1, description: "Primera línea, empieza en 1." },
        hasta_linea: { type: "integer", minimum: 1, description: "Última línea, inclusive." },
        ref: REF,
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: { ...SOLO_LECTURA, title: "Leer archivo del repo" },
    handler: yaEnvuelto(codigoLeer),
  },
  {
    name: "crm_codigo_buscar",
    description:
      "Busca texto en el repositorio usando el índice de código de GitHub. " +
      "Úsala para localizar dónde vive algo cuando no sabes la ruta, antes de recurrir a crm_codigo_arbol. " +
      'Ejemplo: {"patron": "SlaPolicy", "glob": "src/server"}. ' +
      "🚨 Limitación grande: mira SOLO la rama por default, no acepta expresiones regulares y no devuelve número de línea. Un resultado vacío NO prueba que el texto no exista — para eso usa crm_codigo_arbol + crm_codigo_leer.",
    inputSchema: {
      type: "object",
      properties: {
        patron: { type: "string", description: "Texto literal. No es una expresión regular." },
        glob: { type: "string", description: "Filtro de ruta, p. ej. `src/server`." },
        ref: REF,
      },
      required: ["patron"],
      additionalProperties: false,
    },
    annotations: { ...SOLO_LECTURA, title: "Buscar en el repo" },
    handler: yaEnvuelto(codigoBuscar),
  },
  {
    name: "crm_pulso",
    description:
      "El estado del CRM ahora mismo, en conteos: leads, deals por etapa, SLA, cola de acciones, conectores, automatizaciones, usuarios activos y eventos sin procesar. " +
      "Úsala en cada corrida junto con crm_anomalias: el pulso dice cuánto hay, las anomalías dicen si eso es mucho o poco. " +
      "Ejemplo: {} — no recibe argumentos. " +
      "Solo agregados, CERO datos personales: no devuelve nombres, correos ni teléfonos, ni una lista de contactos. Un caso concreto hay que pedírselo a una persona.",
    inputSchema: SIN_ARGS,
    annotations: { ...SOLO_LECTURA, title: "Pulso del CRM" },
    handler: conSobre("conteos agregados del estado actual", pulso),
  },
  {
    name: "crm_anomalias",
    description:
      "Compara cada serie diaria contra la mediana de los 13 días previos y marca `alto`, `bajo` o `normal`. " +
      "Úsala para convertir un conteo en un hallazgo: «14 leads» no es accionable, «14 leads con mediana 60» sí. " +
      "Ejemplo: {} — no recibe argumentos. " +
      "🚨 Compara el ÚLTIMO DÍA COMPLETO, nunca el de hoy. Lo de hoy viene aparte en `hoy_parcial` y NO sirve como evidencia: el día en curso está incompleto y siempre se ve bajo.",
    inputSchema: SIN_ARGS,
    annotations: { ...SOLO_LECTURA, title: "Anomalías contra la mediana" },
    handler: conSobre("series diarias de los últimos 14 días", anomalias),
  },
  {
    name: "crm_fallos",
    description:
      "Lo que se rompió en una ventana, agrupado por firma de error con su conteo y un ejemplo redactado: cola de acciones, leads de conector perdidos, agentes, SLA incumplidos y eventos sin procesar. " +
      "Úsala en cada corrida; mira primero `leads_de_conector_perdidos`, que son leads ya pagados que no llegaron a ningún asesor. " +
      'Ejemplo: {"desde": "2026-08-27T00:00:00Z"}. ' +
      "Cubre fallos de NEGOCIO, no excepciones de runtime: este repo no tiene agregador de 500s. Un resultado vacío significa «sin fallos de negocio», nunca «sin errores». Tope de 30 grupos por categoría, y el recorte se declara.",
    inputSchema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha ISO de inicio. Default: hace 24 horas." },
      },
      additionalProperties: false,
    },
    annotations: { ...SOLO_LECTURA, title: "Fallos agrupados" },
    handler: yaEnvuelto(async (args, ctx) => {
      const datos = await fallos(args, ctx);
      return envolver(
        construirSobre({
          ref: "base de datos en vivo",
          sha: null,
          ahora: ctx.ahora,
          alcance: `fallos desde ${datos.desde}`,
        }),
        datos,
      );
    }),
  },
  {
    name: "crm_practicas",
    description:
      "Catálogo curado de prácticas de CRM inmobiliario; cada una trae `como_se_mide` (cómo comprobarla contra este CRM) y `ya_existe_si` (cómo se ve cuando ya está). " +
      "Úsala en el frente de «oportunidad» de la corrida: mide las de `sugeridas_hoy` en vez de improvisar recomendaciones de memoria. " +
      'Ejemplo: {"area": "velocidad"}. ' +
      "No mide nada por sí sola: dice CÓMO medir, y la medición la haces con crm_pulso, crm_anomalias, crm_fallos o crm_codigo_buscar. Sin esa cifra, el hallazgo no se registra.",
    inputSchema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          enum: [
            "velocidad",
            "calidad_lead",
            "pipeline",
            "seguimiento",
            "inventario",
            "reportes",
            "adopcion",
          ],
          description: "Filtra por área. Omítela para ver el catálogo completo.",
        },
      },
      additionalProperties: false,
    },
    annotations: { ...SOLO_LECTURA, title: "Prácticas de CRM inmobiliario" },
    handler: yaEnvuelto(practicas),
  },
];

import type { GithubReader, LectorDeConfig, RevisionContext, RevisionDb } from "./types";

/**
 * Dobles para las pruebas.
 *
 * Este repo no mockea `@/lib/db` en ningún lado, así que los handlers reciben sus
 * dependencias por el contexto y aquí se sustituyen. El sufijo `.testutil.ts` lo excluye
 * a mano la prueba de solo-lectura: es código de prueba y no viaja al servidor.
 */

export const AHORA = new Date("2026-08-28T15:00:00.000Z");

type Conteos = Record<string, number>;
type Grupos = Record<string, Array<Record<string, unknown>>>;

/**
 * Base de datos falsa. Devuelve lo que se le configure por clave `modelo.metodo`, y
 * REVIENTA ante una clave no configurada en vez de devolver vacío.
 *
 * Un doble que contesta `0` a lo que no sabe convierte un handler que consulta la tabla
 * equivocada en una prueba verde. Fallar ruidosamente es la única forma de que la prueba
 * signifique algo.
 */
export function dbFalsa(cfg: {
  conteos?: Conteos;
  grupos?: Grupos;
  listas?: Grupos;
  fechas?: Record<string, Date[]>;
}): RevisionDb {
  const { conteos = {}, grupos = {}, listas = {}, fechas = {} } = cfg;

  const modelo = (nombre: string) => ({
    count: async () => {
      const k = `${nombre}.count`;
      if (!(k in conteos)) throw new Error(`doble sin configurar: ${k}`);
      return conteos[k];
    },
    groupBy: async () => {
      const k = `${nombre}.groupBy`;
      if (!(k in grupos)) throw new Error(`doble sin configurar: ${k}`);
      return grupos[k];
    },
    findMany: async () => {
      const k = `${nombre}.findMany`;
      if (k in listas) return listas[k];
      if (k in fechas) return fechas[k];
      throw new Error(`doble sin configurar: ${k}`);
    },
  });

  return {
    contact: modelo("contact"),
    deal: modelo("deal"),
    actionQueue: modelo("actionQueue"),
    connectorLeadLog: modelo("connectorLeadLog"),
    slaTimer: modelo("slaTimer"),
    agentRun: modelo("agentRun"),
    workflowEvent: modelo("workflowEvent"),
    leadConnector: modelo("leadConnector"),
    automationRule: modelo("automationRule"),
    user: modelo("user"),
  } as unknown as RevisionDb;
}

export function githubFalso(over: Partial<GithubReader> = {}): GithubReader {
  return {
    resolverRef: async () => "abc1234def5678901234567890abcdef12345678",
    leerArchivo: async (path) => ({ path, contenido: "uno\ndos\ntres", bytes: 13 }),
    listarArbol: async () => ["src/a.ts", "src/b/"],
    listarCommits: async () => [],
    listarPullRequestsAbiertos: async () => [],
    buscar: async () => [],
    ...over,
  };
}

export function ctxFalso(over: Partial<RevisionContext> = {}): RevisionContext {
  return {
    actor: "prueba",
    db: dbFalsa({}),
    gh: githubFalso(),
    ahora: AHORA,
    ...over,
  };
}

/**
 * Lector de `system_config` falso. `null` = no hay fila, que es el caso en que la puerta
 * cae al respaldo del entorno.
 */
export function configFalso(valor: { token?: string; rotadoEn?: string } | null): LectorDeConfig {
  return {
    systemConfig: {
      findUnique: async () =>
        valor === null ? null : { id: "x", key: "mcp.revision.token", value: valor, updatedAt: AHORA },
    },
  } as unknown as LectorDeConfig;
}

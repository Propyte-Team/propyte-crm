import type { PrismaClient } from "@prisma/client";

/**
 * Tipos de la puerta de revisión.
 *
 * OJO CON EL NOMBRE DE LA CARPETA. `src/lib/mcp/` de este repo NO es un servidor MCP: es
 * la pasarela REST de `/api/mcp/[...path]`, con Bearer y ~45 rutas. Esta subcarpeta sí
 * habla JSON-RPC. Se separan a propósito para que nadie planee encima de la otra
 * creyendo que ya existe un MCP.
 */

/**
 * Todo lo que un handler necesita del mundo llega por aquí, nunca por import directo.
 *
 * No es ceremonia: `db` y `gh` se sustituyen por dobles en los tests —este repo no mockea
 * `@/lib/db` en ningún lado— y `ahora` inyectado es lo que hace determinista la mediana
 * de 14 días de `crm_anomalias`. Un handler que leyera `new Date()` por su cuenta se
 * probaría contra el reloj de quien corre la suite.
 */
export type RevisionContext = {
  /** Quién queda registrado como origen de la lectura. */
  actor: string;
  db: RevisionDb;
  gh: GithubReader;
  /** El instante de la corrida. Lo fija el servidor una vez y lo comparten todos los handlers. */
  ahora: Date;
};

/**
 * La porción de Prisma que esta puerta usa. Es un subconjunto A PROPÓSITO.
 *
 * ⚠️ NO BASTA CON `Pick<PrismaClient, "contact" | …>`. Eso elige las CLAVES, y el valor
 * de cada una sigue siendo el delegate completo —con `create`, `update` y `delete`
 * dentro—, así que un handler que escribiera compilaría sin queja. Es un error fácil de
 * cometer y de creerse: parece restrictivo y no restringe nada.
 *
 * Por eso cada modelo se mapea a `SoloLectura`: se quedan los métodos de consulta y
 * desaparecen los de escritura. `db.contact.create(...)` no compila, y eso sí es una
 * garantía. La prueba de §4.2 es la segunda red, para lo que el tipo no ve —`$queryRaw`,
 * un `fetch` con POST, un `as any`—.
 */
type MetodosDeLectura =
  | "findMany"
  | "findFirst"
  | "findFirstOrThrow"
  | "findUnique"
  | "findUniqueOrThrow"
  | "count"
  | "groupBy"
  | "aggregate";

type SoloLectura<T> = Pick<T, Extract<keyof T, MetodosDeLectura>>;

type ModelosLeidos =
  | "contact"
  | "deal"
  | "actionQueue"
  | "connectorLeadLog"
  | "slaTimer"
  | "agentRun"
  | "workflowEvent"
  | "leadConnector"
  | "automationRule"
  | "user";

export type RevisionDb = { [K in ModelosLeidos]: SoloLectura<PrismaClient[K]> };

/**
 * Lo mínimo para leer el secreto de la puerta: una sola fila de `system_config`.
 *
 * Va aparte de `RevisionDb` porque no es un dato del CRM que el revisor pueda consultar
 * —es la credencial— y mezclarlo dejaría `systemConfig` al alcance de cualquier handler
 * nuevo que se agregue.
 */
export type LectorDeConfig = { systemConfig: SoloLectura<PrismaClient["systemConfig"]> };

/** Un archivo del repo, tal como lo devuelve GitHub, ya rotulado con la ref resuelta. */
export type ArchivoRepo = {
  path: string;
  contenido: string;
  /** Bytes del archivo completo, antes de cualquier recorte. */
  bytes: number;
};

export type CommitRepo = {
  sha: string;
  fecha: string;
  autor: string;
  mensaje: string;
};

export type PullRequestRepo = {
  numero: number;
  titulo: string;
  estado: string;
  rama: string;
  actualizado: string;
  borrador: boolean;
};

export type CoincidenciaBusqueda = {
  path: string;
  linea: number;
  texto: string;
};

/**
 * Lo que la puerta necesita de GitHub. Solo lectura: no hay un solo método que escriba.
 *
 * Se lee de GitHub y NUNCA del filesystem del deploy. Ese es el punto entero: durante el
 * diseño, un checkout local en una rama vieja no contenía archivos que sí estaban en
 * `main`, y un revisor que leyera del disco habría reportado que no existen. Ver §2 del
 * spec.
 */
export type GithubReader = {
  /** Resuelve una ref (rama, tag o SHA) al SHA del commit. Es lo que se rotula en el sobre. */
  resolverRef(ref: string): Promise<string>;
  leerArchivo(path: string, ref: string): Promise<ArchivoRepo>;
  listarArbol(path: string, ref: string): Promise<string[]>;
  listarCommits(desde: Date, hasta: Date, ref: string, tope: number): Promise<CommitRepo[]>;
  listarPullRequestsAbiertos(): Promise<PullRequestRepo[]>;
  buscar(patron: string, glob: string | undefined, ref: string, tope: number): Promise<CoincidenciaBusqueda[]>;
};

/** El sobre de rotulado de §4.3. Va en TODA respuesta de TODA tool. */
export type Sobre = {
  ref: string;
  /** SHA resuelto de la ref. `null` solo cuando la tool no consultó el repo. */
  sha: string | null;
  medido_en: string;
  alcance: string;
  /**
   * Presente SOLO cuando se recortó. Un truncado silencioso se lee como "eso es todo lo
   * que hay", y esa lectura equivocada es exactamente la que produce hallazgos falsos.
   */
  truncado?: { motivo: string; devueltos: number; tope: number };
};

export type RespuestaRevision<T> = { sobre: Sobre; datos: T };

export type RevisionTool = {
  name: string;
  /**
   * Lo que el agente lee para decidir. No es documentación: junto con el nombre y el
   * schema es TODO lo que el cliente ve.
   *
   * Contrato de cuatro partes: intención · cuándo usarla · un ejemplo concreto · una
   * limitación declarada. La cuarta es la que más ahorra — una tool sin límite declarado
   * se elige para lo que no puede y el agente no sabe si el problema es su input.
   */
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * `readOnlyHint` es la promesa "esta tool no escribe" hecha visible en el handshake.
   * Si vive solo en un test, el cliente no puede verla. En esta puerta es SIEMPRE true.
   */
  annotations?: { readOnlyHint?: boolean; title?: string };
  handler: (args: unknown, ctx: RevisionContext) => Promise<unknown>;
};

export type RevisionServerInfo = { name: string; version: string };

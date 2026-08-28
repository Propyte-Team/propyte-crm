import { RevisionError } from "./errors";
import type { RevisionContext, RevisionServerInfo, RevisionTool } from "./types";

/**
 * Núcleo JSON-RPC 2.0 de la puerta de revisión, a mano y no con el SDK de MCP.
 *
 * POR QUÉ A MANO. Los transportes del SDK están pensados para stdio o para un servidor
 * `http` de Node con `req`/`res`; un route handler de Next recibe un `Request` de la web
 * y devuelve un `Response`, y adaptar el transporte cuesta más que el protocolo. Para un
 * servidor que SOLO expone tools la superficie es esta: `initialize`,
 * `notifications/initialized`, `tools/list`, `tools/call` y `ping`.
 *
 * Es el mismo núcleo que ya corre en las dos puertas del Hub. Se porta en vez de
 * importarse porque son repos distintos, y se porta ENTERO en vez de reescribirse: lo que
 * divergiría entre dos versiones es cómo se reporta el fallo de una tool, que es justo lo
 * que no puede diferir entre puertas que el mismo agente usa en la misma sesión.
 */

export const REVISION_SERVER_INFO: RevisionServerInfo = {
  name: "propyte-crm-revision",
  version: "0.1.0",
};

/** Versión del spec que se anuncia cuando el cliente no pide ninguna. */
export const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

/**
 * Se le devuelve al cliente LA VERSIÓN QUE PIDIÓ.
 *
 * Es la opción permisiva a propósito. El cliente puede ir a una revisión del spec distinta
 * de la nuestra, y como este servidor no depende de ninguna capability versionada —son
 * tools y nada más— un handshake estricto solo lograría romper una integración que por lo
 * demás funciona.
 */
function negociaVersion(params: unknown): string {
  const pedida = (params as { protocolVersion?: unknown } | null)?.protocolVersion;
  return typeof pedida === "string" && pedida.trim().length > 0 ? pedida : DEFAULT_PROTOCOL_VERSION;
}

/** Forma pública de una tool: lo que ve `tools/list`, sin el handler. */
export function toolDescriptor(t: RevisionTool) {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    ...(t.annotations ? { annotations: t.annotations } : {}),
  };
}

/**
 * Procesa un mensaje JSON-RPC.
 *
 * Devuelve `null` cuando NO hay que contestar: las notificaciones (mensajes sin `id`) no
 * llevan respuesta según el spec, y contestarlas hace que algunos clientes registren un
 * error espurio.
 */
export async function handleRpcMessage(
  body: unknown,
  ctx: RevisionContext,
  opts: { tools: RevisionTool[]; serverInfo?: RevisionServerInfo },
): Promise<JsonRpcResponse | null> {
  const tools = opts.tools;
  const serverInfo = opts.serverInfo ?? REVISION_SERVER_INFO;

  // Los batches se dejaron fuera: el spec de MCP los retiró y aceptarlos sin necesidad
  // solo agrega una forma más que mantener y testear.
  if (Array.isArray(body)) {
    return fail(null, RPC.INVALID_REQUEST, "Esta puerta no acepta batches JSON-RPC.");
  }
  if (!body || typeof body !== "object") {
    return fail(null, RPC.INVALID_REQUEST, "El cuerpo no es un mensaje JSON-RPC.");
  }

  const msg = body as JsonRpcRequest;
  const id = msg.id === undefined ? null : msg.id;
  const esNotificacion = msg.id === undefined;
  const method = typeof msg.method === "string" ? msg.method : "";

  if (!method) {
    return esNotificacion ? null : fail(id, RPC.INVALID_REQUEST, "Falta `method`.");
  }

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: negociaVersion(msg.params),
        capabilities: { tools: {} },
        serverInfo,
      });

    case "notifications/initialized":
    case "initialized":
      return null;

    case "ping":
      return esNotificacion ? null : ok(id, {});

    case "tools/list":
      return ok(id, { tools: tools.map(toolDescriptor) });

    case "tools/call": {
      const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
      const name = typeof params.name === "string" ? params.name : "";
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        return fail(id, RPC.INVALID_PARAMS, `Tool desconocida: "${name}".`, {
          disponibles: tools.map((t) => t.name),
        });
      }
      try {
        const result = await tool.handler(params.arguments ?? {}, ctx);
        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (e) {
        /**
         * El fallo de una tool va como `isError` DENTRO del result, no como error de
         * JSON-RPC. Es lo que dice el spec y además es lo útil: el modelo lee el motivo y
         * corrige, en vez de que el cliente trate el turno como transporte roto.
         *
         * El código HTTP viaja en el texto porque 400, 404 y 503 significan cosas
         * distintas y accionables: 503 es "falta una variable de entorno y aquí está su
         * nombre", que es accionable por una persona, no por el agente.
         */
        const status = e instanceof RevisionError ? e.status : 500;
        const message = e instanceof Error ? e.message : "error desconocido";
        const details = e instanceof RevisionError ? e.details : undefined;
        return ok(id, {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ status, error: message, details: details ?? null }, null, 2),
            },
          ],
        });
      }
    }

    default:
      return esNotificacion
        ? null
        : fail(id, RPC.METHOD_NOT_FOUND, `Método no soportado: "${method}".`);
  }
}

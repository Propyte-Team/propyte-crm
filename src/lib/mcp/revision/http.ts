import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { autorizarRevision, HINT_AUTH } from "./auth";
import { crearGithubReader } from "./github";
import { handleRpcMessage, RPC } from "./rpc";
import { REVISION_TOOLS } from "./tools";
import type { RevisionContext } from "./types";

/**
 * Capa HTTP de la puerta de revisión: JSON-RPC 2.0 en el cuerpo, un POST por mensaje.
 *
 * Vive aquí y no en las routes porque la puerta monta DOS rutas —una que autentica por
 * cabecera y otra por el segmento de la URL— y dos copias de esta orquestación
 * divergirían en el primer cambio. Lo que divergiría es de dónde se acepta el secreto, y
 * una ruta que dejara de aceptar la URL quedaría cerrada para claude.ai sin que ningún
 * test lo delate.
 *
 * No hay SSE: ninguna tool de esta puerta tarda minutos. Todas son consultas agregadas o
 * dos llamadas a la API de GitHub. Si alguna llegara a tardar, el modo de falla conocido
 * es que nginx corta la petición sin bytes, y entonces habría que traer el stream del
 * Hub — no antes.
 */

const ACTOR = process.env.MCP_REVISION_ACTOR ?? "cowork@revision";

export async function handleRevisionMcpHttp(
  req: Request,
  tokenDeUrl?: string,
): Promise<Response> {
  const auth = autorizarRevision(req, process.env.MCP_REVISION_TOKEN ?? "", tokenDeUrl);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error, hint: auth.hint }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: RPC.PARSE_ERROR, message: "JSON inválido." } },
      { status: 400 },
    );
  }

  // El instante se fija UNA VEZ por petición y lo comparten todos los handlers. Si cada
  // uno leyera su propio reloj, dos consultas de la misma respuesta podrían caer en días
  // distintos justo en el cambio de fecha, y la comparación contra la mediana saldría mal
  // sin que nada lo delate.
  const ctx: RevisionContext = {
    actor: ACTOR,
    db: prisma,
    gh: crearGithubReader(),
    ahora: new Date(),
  };

  try {
    const res = await handleRpcMessage(body, ctx, { tools: REVISION_TOOLS });
    // Las notificaciones no llevan respuesta. 202 con cuerpo vacío es lo que esperan los
    // clientes de MCP; contestarles un objeto hace que registren un error espurio.
    if (res === null) return new Response(null, { status: 202 });
    return NextResponse.json(res);
  } catch (e) {
    // Red de seguridad: un fallo del dispatcher mismo. Los fallos de una tool NO llegan
    // acá — viajan como `isError` dentro del result, que es lo que dice el spec.
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: RPC.INTERNAL_ERROR,
          message: e instanceof Error ? e.message : "error interno",
        },
      },
      { status: 500 },
    );
  }
}

export { HINT_AUTH };

import { handleRevisionMcpHttp } from "@/lib/mcp/revision/http";

/**
 * POST /api/mcp/revision — la puerta de revisión autenticando por cabecera.
 *
 * Es el camino correcto y el que usa cualquier cliente que sí pueda mandar
 * `Authorization: Bearer`. La ruta hermana con el token en el segmento existe solo para
 * claude.ai, que no manda cabeceras.
 *
 * Mismo secreto, mismo catálogo, misma comparación en tiempo constante.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = async (req: Request) => handleRevisionMcpHttp(req);

export const POST = handler;
export const GET = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;

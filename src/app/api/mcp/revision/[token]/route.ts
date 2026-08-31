import { handleRevisionMcpHttp } from "@/lib/mcp/revision/http";

/**
 * POST /api/mcp/revision/:token — la puerta de revisión con el secreto en la URL.
 *
 * Existe por un límite del cliente, no por gusto. El diálogo "Agregar conector
 * personalizado" de claude.ai pide una URL y, como mucho, credenciales de OAuth: no tiene
 * dónde escribir una cabecera. Sin esta ruta, Cowork no puede conectar la puerta por bien
 * desplegado que esté el servidor. Ya se midió dos veces en este ecosistema.
 *
 * Lo que NO cambia: el secreto es el mismo `MCP_REVISION_TOKEN`, se compara en tiempo
 * constante, y un servidor sin la variable configurada rechaza todo. El costo asumido —el
 * secreto queda en los logs de acceso— y su mitigación están en `../../../../lib/mcp/revision/auth.ts`.
 *
 * 🚨 OJO CON EL VECINO: `/api/mcp/[...path]` de este mismo repo NO es un servidor MCP, es
 * una pasarela REST con otro token que además ESCRIBE. Son puertas distintas con
 * credenciales distintas a propósito.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * `params` es un objeto plano, NO una promesa: este repo va en Next 14. La firma con
 * `Promise` es de Next 15 y `tsc --noEmit` no la delata —valida la anotación que uno
 * escribe, no la que Next espera—; el que falla es `next build`.
 */
type Ctx = { params: { token: string } };

const handler = async (req: Request, ctx: Ctx) => handleRevisionMcpHttp(req, ctx.params.token);

export const POST = handler;
// El resto de métodos existe para contestar 405 con el motivo —la autorización los
// rechaza antes de tocar nada— en vez de un 404 que mandaría a revisar la URL.
export const GET = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;

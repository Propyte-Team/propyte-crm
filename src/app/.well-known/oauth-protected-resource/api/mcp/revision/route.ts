import { NextResponse } from "next/server";
import { origenPublico } from "@/lib/mcp/origen-publico";

/**
 * GET /.well-known/oauth-protected-resource/api/mcp/revision — metadata RFC 9728 de la
 * puerta de revisión.
 *
 * Por qué existe: medido el 2026-09-17, este origen contestaba 404 a todo `/.well-known/`
 * y su 401 salía sin `WWW-Authenticate`, así que un cliente MCP no tenía de dónde sacar
 * cómo autenticarse, y el conector de claude.ai no montaba en corridas programadas. El
 * control del experimento es la puerta de mejoras del Hub, que se deja SIN esto a
 * propósito.
 *
 * `authorization_servers` se omite porque no hay servidor de autorización que anunciar:
 * esta puerta valida un secreto estático que vive en la base y se rota desde
 * `/revision/conectar`. Eso es lo que declara `bearer_methods_supported`.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = origenPublico(req);

  return NextResponse.json(
    {
      resource: `${origin}/api/mcp/revision`,
      bearer_methods_supported: ["header"],
      resource_name: "Revisión Propyte CRM",
    },
    { headers: { "cache-control": "no-store" } },
  );
}

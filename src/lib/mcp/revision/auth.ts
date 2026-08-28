import { timingSafeEqual } from "node:crypto";

/**
 * Autorización de la puerta de revisión.
 *
 * 🚨 `MCP_REVISION_TOKEN` ES EL CUARTO SECRETO DISTINTO de este ecosistema y no comparte
 * credencial con ninguno:
 *
 * - `CRM_MCP_API_TOKEN` → pasarela REST `/api/mcp/[...path]` de este mismo repo. **Es de
 *   escritura**: abre `POST /automation/rules`, `/connectors` y `/config/fields`.
 * - `MCP_BLOG_TOKEN` y `MCP_MEJORAS_TOKEN` → las dos puertas del Hub.
 *
 * Que no se compartan es el punto entero. Esta puerta la consume Cowork, que es un
 * tercero automático corriendo sin supervisión todos los días; darle una credencial que
 * también abre escrituras anularía la decisión de que solo proponga.
 */

export type RevisionAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string; hint: string };

/** El 401 NOMBRA la variable de ESTA puerta. Ver el comentario de `errors.faltaVariable`. */
export const HINT_AUTH =
  "MCP_REVISION_TOKEN inválido o ausente. Ojo: NO es CRM_MCP_API_TOKEN (ese es de escritura), " +
  "ni MCP_BLOG_TOKEN, ni MCP_MEJORAS_TOKEN.";

/**
 * Comparación en tiempo constante.
 *
 * `timingSafeEqual` revienta si los buffers miden distinto, así que la diferencia de
 * longitud se resuelve antes, devolviendo `false`: un token de otro largo es simplemente
 * un token equivocado, no una excepción.
 */
function tokensCoinciden(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido, "utf8");
  const b = Buffer.from(esperado, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * De dónde puede venir el secreto, en orden de preferencia.
 *
 * La cabecera es el camino correcto y sigue siendo el primero. Los otros dos existen por
 * un límite del cliente, no por gusto: el diálogo "Agregar conector personalizado" de
 * claude.ai pide una URL y, como mucho, OAuth — no hay dónde escribir un `Authorization`.
 * Para ese cliente, una puerta que solo lee cabeceras está cerrada. Ya se midió dos veces
 * en este proyecto.
 *
 * Costo asumido y documentado en §10 del spec: la URL viaja cifrada por TLS pero queda
 * escrita en los logs de acceso del servidor. Se mitiga con rotación, y el secreto solo
 * abre lecturas agregadas.
 */
function tokensCandidatos(req: Request, tokenDeUrl?: string): string[] {
  const candidatos: string[] = [];

  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/);
  if (match) candidatos.push(match[1].trim());

  if (tokenDeUrl) {
    // Next entrega el segmento ya decodificado, pero un cliente que lo mande doblemente
    // escapado no merece un 401 que no explica nada. Si no es decodificable se usa tal
    // cual: un `%` suelto es un token equivocado, no un 500.
    let plano = tokenDeUrl;
    try {
      plano = decodeURIComponent(tokenDeUrl);
    } catch {
      // Se queda con el original.
    }
    candidatos.push(plano.trim());
  }

  // Alternativa por query, para clientes que normalizan o recortan el path.
  try {
    const q = new URL(req.url).searchParams.get("token");
    if (q) candidatos.push(q.trim());
  } catch {
    // URL inválida: no hay query de dónde sacar nada. No es motivo de 500.
  }

  return candidatos;
}

export function autorizarRevision(
  req: Request,
  expectedToken: string,
  tokenDeUrl?: string,
): RevisionAuthResult {
  const unauthorized = (): RevisionAuthResult => ({
    ok: false,
    status: 401,
    error: "unauthorized",
    hint: HINT_AUTH,
  });

  // El transporte es un POST y nada más. Un GET suele ser alguien buscando un stream SSE
  // que esta puerta no necesita, y contestarle 405 con el motivo es más útil que un 404
  // que mandaría a revisar la URL.
  if (req.method !== "POST") {
    return {
      ok: false,
      status: 405,
      error: "method_not_allowed",
      hint: "Esta puerta habla JSON-RPC por POST. No hay stream SSE: solo expone tools de lectura.",
    };
  }

  // 🚨 Servidor sin token configurado: se rechaza TODO. Un servidor sin secreto no es un
  // servidor abierto, es un servidor mal desplegado.
  //
  // Con el token en la URL esto deja de ser hipotético: sin esta guarda, un deploy sin la
  // variable compararía cadena vacía contra cadena vacía y CUALQUIER URL abriría la
  // puerta a los datos del CRM.
  if (!expectedToken) return unauthorized();

  // Se prueban todos los orígenes: una cabecera equivocada no puede invalidar una URL
  // correcta. El cliente que autentica por URL puede traer un `Authorization` propio de
  // su infraestructura que no tiene nada que ver con esta puerta.
  const candidatos = tokensCandidatos(req, tokenDeUrl);
  if (candidatos.length === 0) return unauthorized();

  return candidatos.some((c) => tokensCoinciden(c, expectedToken))
    ? { ok: true }
    : unauthorized();
}

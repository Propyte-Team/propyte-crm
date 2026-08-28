import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRevisionMcpHttp } from "./http";

/**
 * La puerta HTTP de verdad, no sus piezas por separado.
 *
 * Las pruebas de `auth`, `rpc` y `tools` verifican cada capa contra dobles. Ninguna
 * demuestra que las tres estén CONECTADAS: un `handleRevisionMcpHttp` que olvidara pasar
 * el catálogo, o que leyera la variable de entorno equivocada, pasaría todas y devolvería
 * cero tools en producción.
 *
 * Ninguna de estas llamadas toca la base: el handshake y `tools/list` se contestan desde
 * el catálogo. Por eso este archivo puede correr sin `DATABASE_URL`.
 */

const TOKEN = "t".repeat(64);
const URL_BASE = "https://crm.propyte.com/api/mcp/revision";

let tokenPrevio: string | undefined;

beforeEach(() => {
  tokenPrevio = process.env.MCP_REVISION_TOKEN;
  process.env.MCP_REVISION_TOKEN = TOKEN;
});

afterEach(() => {
  if (tokenPrevio === undefined) delete process.env.MCP_REVISION_TOKEN;
  else process.env.MCP_REVISION_TOKEN = tokenPrevio;
});

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("handleRevisionMcpHttp", () => {
  it("sin token: 401 nombrando la variable", async () => {
    const res = await handleRevisionMcpHttp(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(res.status).toBe(401);
    expect((await res.json()).hint).toContain("MCP_REVISION_TOKEN");
  });

  it("con el token en la RUTA —el único camino de claude.ai— devuelve las 9 tools", async () => {
    const res = await handleRevisionMcpHttp(
      rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      TOKEN,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    const tools = body.result.tools as Array<{ name: string; description: string }>;
    expect(tools).toHaveLength(9);
    // El catálogo llega ENTERO: es justo lo que un cableado roto dejaría vacío.
    expect(tools.map((t) => t.name)).toContain("crm_revision_protocolo");
    for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
  });

  it("con el token por cabecera también abre", async () => {
    const res = await handleRevisionMcpHttp(
      rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer ${TOKEN}` }),
    );
    expect(res.status).toBe(200);
  });

  it("initialize devuelve la identidad del servidor", async () => {
    const res = await handleRevisionMcpHttp(
      rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      TOKEN,
    );
    expect((await res.json()).result.serverInfo.name).toBe("propyte-crm-revision");
  });

  it("una notificación se contesta 202 sin cuerpo", async () => {
    // Contestarle un objeto hace que los clientes de MCP registren un error espurio.
    const res = await handleRevisionMcpHttp(
      rpc({ jsonrpc: "2.0", method: "notifications/initialized" }),
      TOKEN,
    );
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("un cuerpo que no es JSON da PARSE_ERROR, no un 500", async () => {
    const req = new Request(URL_BASE, { method: "POST", body: "esto no es json{" });
    const res = await handleRevisionMcpHttp(req, TOKEN);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32700);
  });

  it("🚨 servidor sin la variable configurada: rechaza incluso la URL vacía", async () => {
    delete process.env.MCP_REVISION_TOKEN;
    const res = await handleRevisionMcpHttp(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }), "");
    expect(res.status).toBe(401);
  });

  it("un GET contesta 405 con el motivo, no 404", async () => {
    const res = await handleRevisionMcpHttp(new Request(URL_BASE, { method: "GET" }), TOKEN);
    expect(res.status).toBe(405);
    expect((await res.json()).hint).toMatch(/POST/);
  });
});

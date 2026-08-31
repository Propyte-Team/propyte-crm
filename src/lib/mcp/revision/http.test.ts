import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configFalso } from "./dobles.testutil";
import { handleRevisionMcpHttp } from "./http";

/**
 * La puerta HTTP de verdad, no sus piezas por separado.
 *
 * Las pruebas de `auth`, `rpc`, `token` y `tools` verifican cada capa contra dobles.
 * Ninguna demuestra que las cuatro estén CONECTADAS: un `handleRevisionMcpHttp` que
 * olvidara pasar el catálogo, o que leyera el token del sitio equivocado, pasaría todas
 * y en producción devolvería cero tools o abriría con el secreto viejo.
 *
 * Ninguna de estas llamadas toca la base ni GitHub: el handshake y `tools/list` se
 * contestan desde el catálogo, y el lector de config va sustituido.
 */

const EN_BASE = "b".repeat(64);
const EN_ENTORNO = "e".repeat(64);
const URL_BASE = "https://crm.propyte.com/api/mcp/revision";

let previo: string | undefined;

beforeEach(() => {
  previo = process.env.MCP_REVISION_TOKEN;
  delete process.env.MCP_REVISION_TOKEN;
});

afterEach(() => {
  if (previo === undefined) delete process.env.MCP_REVISION_TOKEN;
  else process.env.MCP_REVISION_TOKEN = previo;
});

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const listar = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const conBase = { config: configFalso({ token: EN_BASE }) };

describe("handleRevisionMcpHttp", () => {
  it("sin token: 401 nombrando la variable", async () => {
    const res = await handleRevisionMcpHttp(rpc(listar), undefined, {
      config: configFalso(null),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).hint).toContain("MCP_REVISION_TOKEN");
  });

  it("con el token en la RUTA —el único camino de claude.ai— devuelve las 9 tools", async () => {
    const res = await handleRevisionMcpHttp(rpc(listar), EN_BASE, conBase);
    expect(res.status).toBe(200);

    const tools = (await res.json()).result.tools as Array<{ name: string; description: string }>;
    expect(tools).toHaveLength(9);
    // El catálogo llega ENTERO: es justo lo que un cableado roto dejaría vacío.
    expect(tools.map((t) => t.name)).toContain("crm_revision_protocolo");
    for (const t of tools) expect(t.description.length).toBeGreaterThan(0);
  });

  it("con el token por cabecera también abre", async () => {
    const res = await handleRevisionMcpHttp(
      rpc(listar, { authorization: `Bearer ${EN_BASE}` }),
      undefined,
      conBase,
    );
    expect(res.status).toBe(200);
  });

  it("🚨 el token de la BASE gana sobre el del entorno", async () => {
    // Si el entorno ganara, rotar desde la pantalla no tendría efecto mientras la variable
    // siguiera puesta: la pantalla diría "rotado" y el secreto viejo seguiría abriendo.
    process.env.MCP_REVISION_TOKEN = EN_ENTORNO;

    expect((await handleRevisionMcpHttp(rpc(listar), EN_BASE, conBase)).status).toBe(200);
    expect((await handleRevisionMcpHttp(rpc(listar), EN_ENTORNO, conBase)).status).toBe(401);
  });

  it("sin fila en la base cae al entorno, que es el arranque", async () => {
    process.env.MCP_REVISION_TOKEN = EN_ENTORNO;
    const res = await handleRevisionMcpHttp(rpc(listar), EN_ENTORNO, {
      config: configFalso(null),
    });
    expect(res.status).toBe(200);
  });

  it("initialize devuelve la identidad del servidor", async () => {
    const res = await handleRevisionMcpHttp(
      rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      EN_BASE,
      conBase,
    );
    expect((await res.json()).result.serverInfo.name).toBe("propyte-crm-revision");
  });

  it("una notificación se contesta 202 sin cuerpo", async () => {
    // Contestarle un objeto hace que los clientes de MCP registren un error espurio.
    const res = await handleRevisionMcpHttp(
      rpc({ jsonrpc: "2.0", method: "notifications/initialized" }),
      EN_BASE,
      conBase,
    );
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("un cuerpo que no es JSON da PARSE_ERROR, no un 500", async () => {
    const req = new Request(URL_BASE, { method: "POST", body: "esto no es json{" });
    const res = await handleRevisionMcpHttp(req, EN_BASE, conBase);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32700);
  });

  it("🚨 sin token en ningún lado rechaza incluso la URL vacía", async () => {
    const res = await handleRevisionMcpHttp(rpc(listar), "", { config: configFalso(null) });
    expect(res.status).toBe(401);
  });

  it("un GET contesta 405 con el motivo, no 404", async () => {
    const res = await handleRevisionMcpHttp(new Request(URL_BASE, { method: "GET" }), EN_BASE, conBase);
    expect(res.status).toBe(405);
    expect((await res.json()).hint).toMatch(/POST/);
  });
});

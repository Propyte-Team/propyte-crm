import { describe, expect, it } from "vitest";
import { ctxFalso } from "./dobles.testutil";
import { RevisionError } from "./errors";
import { handleRpcMessage, REVISION_SERVER_INFO, RPC } from "./rpc";
import type { RevisionTool } from "./types";

const tools: RevisionTool[] = [
  {
    name: "eco",
    description: "Devuelve lo que recibe.",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
    handler: async (args) => ({ recibido: args }),
  },
  {
    name: "revienta",
    description: "Siempre falla.",
    inputSchema: { type: "object" },
    handler: async () => {
      throw new RevisionError(404, "no está", { pista: "revisa la ruta" });
    },
  },
];

const call = (body: unknown) => handleRpcMessage(body, ctxFalso(), { tools });

describe("handleRpcMessage", () => {
  it("initialize devuelve la versión que pidió el cliente", async () => {
    const r = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    expect(r?.result).toMatchObject({
      protocolVersion: "2024-11-05",
      serverInfo: REVISION_SERVER_INFO,
    });
  });

  it("initialize sin versión anuncia la del servidor", async () => {
    const r = await call({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect((r?.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
  });

  it("notifications/initialized no se contesta", async () => {
    // Contestar una notificación hace que algunos clientes registren un error espurio.
    expect(await call({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("tools/list devuelve el catálogo sin los handlers", async () => {
    const r = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const lista = (r?.result as { tools: Array<Record<string, unknown>> }).tools;
    expect(lista).toHaveLength(2);
    expect(lista[0]).not.toHaveProperty("handler");
    expect(lista[0].annotations).toEqual({ readOnlyHint: true });
  });

  it("tools/call ejecuta y serializa el resultado", async () => {
    const r = await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "eco", arguments: { a: 1 } } });
    const texto = (r?.result as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(texto)).toEqual({ recibido: { a: 1 } });
  });

  it("una tool desconocida lista las disponibles", async () => {
    const r = await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "fantasma" } });
    expect(r?.error?.code).toBe(RPC.INVALID_PARAMS);
    expect((r?.error?.data as { disponibles: string[] }).disponibles).toEqual(["eco", "revienta"]);
  });

  it("el fallo de una tool viaja como isError DENTRO del result, no como error de JSON-RPC", async () => {
    // Es lo que dice el spec y además es lo útil: el modelo lee el motivo y corrige, en
    // vez de que el cliente trate el turno como transporte roto.
    const r = await call({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "revienta" } });
    expect(r?.error).toBeUndefined();
    const result = r?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 404, error: "no está" });
  });

  it("método desconocido con id devuelve METHOD_NOT_FOUND", async () => {
    const r = await call({ jsonrpc: "2.0", id: 6, method: "inventado" });
    expect(r?.error?.code).toBe(RPC.METHOD_NOT_FOUND);
  });

  it("método desconocido SIN id no se contesta", async () => {
    expect(await call({ jsonrpc: "2.0", method: "inventado" })).toBeNull();
  });

  it("rechaza batches, que el spec retiró", async () => {
    const r = await call([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
    expect(r?.error?.code).toBe(RPC.INVALID_REQUEST);
  });

  it("ping contesta vacío", async () => {
    const r = await call({ jsonrpc: "2.0", id: 7, method: "ping" });
    expect(r?.result).toEqual({});
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 2026-10-12: askClaude dice POR QUÉ no trajo texto (sin llave, respuesta vacía, error de la
// API) en un segundo argumento opcional, sin cambiar su contrato: texto o null, y lanza ante
// un error de la API, igual que antes. La llave nunca aparece ni en el error ni en el detalle.

import { askClaude, type DiagnosticoClaude } from "./claude";

// Llave falsa: solo existe en esta prueba.
const LLAVE = "sk-ant-prueba-0000-llave-falsa";
const MSGS = [{ role: "user" as const, content: "hola" }];

function respuesta(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ANTHROPIC_API_KEY", LLAVE);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("askClaude — diagnóstico", () => {
  it("sin llave: null, motivo sin_api_key y ni siquiera llama a la API", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "  ");
    const diag: DiagnosticoClaude = {};

    await expect(askClaude({ messages: MSGS }, diag)).resolves.toBeNull();

    expect(diag.sinRespuesta).toEqual({ motivo: "sin_api_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin pasar diagnóstico todo sigue igual (null sin llave)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(askClaude({ messages: MSGS })).resolves.toBeNull();
  });

  it("texto: lo devuelve recortado y no llena el diagnóstico", async () => {
    fetchMock.mockResolvedValue(respuesta(200, { content: [{ type: "text", text: "  Hola Ana  " }], stop_reason: "end_turn" }));
    const diag: DiagnosticoClaude = {};

    await expect(askClaude({ messages: MSGS }, diag)).resolves.toBe("Hola Ana");

    expect(diag.sinRespuesta).toBeUndefined();
  });

  it("la API contesta sin texto: null y motivo respuesta_vacia con el stop_reason", async () => {
    fetchMock.mockResolvedValue(respuesta(200, { content: [], stop_reason: "max_tokens" }));
    const diag: DiagnosticoClaude = {};

    await expect(askClaude({ messages: MSGS }, diag)).resolves.toBeNull();

    expect(diag.sinRespuesta).toEqual({ motivo: "respuesta_vacia", stopReason: "max_tokens" });
  });

  it("error de la API (400): lanza el mismo error de siempre y el diagnóstico trae status y tipo: mensaje, sin request_id", async () => {
    fetchMock.mockResolvedValue(
      respuesta(400, {
        type: "error",
        error: { type: "invalid_request_error", message: "model: claude-x no existe" },
        request_id: "req_011CambiaCadaVez",
      }),
    );
    const diag: DiagnosticoClaude = {};

    await expect(askClaude({ messages: MSGS }, diag)).rejects.toThrow(/^Claude API 400: \{"type":"error"/);

    expect(diag.sinRespuesta).toEqual({
      motivo: "error_api",
      status: 400,
      detalle: "invalid_request_error: model: claude-x no existe",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // 400 no se reintenta
  });

  it("cuerpo de error que no es JSON: el texto recortado", async () => {
    fetchMock.mockResolvedValue(respuesta(401, "unauthorized"));
    const diag: DiagnosticoClaude = {};

    await expect(askClaude({ messages: MSGS }, diag)).rejects.toThrow("Claude API 401: unauthorized");

    expect(diag.sinRespuesta).toEqual({ motivo: "error_api", status: 401, detalle: "unauthorized" });
  });

  it("la llave NUNCA sale: ni en el error lanzado ni en el diagnóstico, aunque la API la repita", async () => {
    fetchMock.mockResolvedValue(respuesta(401, { type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${LLAVE}` } }));
    const diag: DiagnosticoClaude = {};

    const err = await askClaude({ messages: MSGS }, diag).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(LLAVE);
    expect(JSON.stringify(diag)).not.toContain(LLAVE);
    expect(JSON.stringify(diag)).toContain("[oculto]");
  });

  it("la llamada no se completa (fallo de red, también en el reintento): lanza el error original y status null", async () => {
    const red = new TypeError("fetch failed");
    fetchMock.mockRejectedValue(red);
    const diag: DiagnosticoClaude = {};

    await expect(askClaude({ messages: MSGS }, diag)).rejects.toBe(red);

    expect(diag.sinRespuesta).toEqual({ motivo: "error_api", status: null, detalle: "TypeError: fetch failed" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tiempo agotado (AbortError): el detalle lo dice en español", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
    const diag: DiagnosticoClaude = {};

    await expect(askClaude({ messages: MSGS }, diag)).rejects.toThrow("aborted");

    expect(diag.sinRespuesta).toMatchObject({ motivo: "error_api", status: null });
    expect((diag.sinRespuesta as { detalle: string }).detalle).toContain("tiempo agotado");
  });
});

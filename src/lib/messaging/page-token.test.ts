import { describe, it, expect, vi } from "vitest";
import { verifyPageToken, pageMismatchMessage, mergePageToken } from "./page-token";

function fetchReplies(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) }) as unknown as typeof fetch;
}
const callsOf = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls;

describe("verifyPageToken", () => {
  it("un token de Página devuelve la Página misma", async () => {
    const out = await verifyPageToken("TOKEN", fetchReplies({ id: "PAGE-1", name: "Nativa Tulum" }));
    expect(out).toEqual({ ok: true, pageId: "PAGE-1", pageName: "Nativa Tulum" });
  });

  it("el token va en la cabecera, nunca en la URL", async () => {
    const f = fetchReplies({ id: "PAGE-1", name: "Nativa Tulum" });
    await verifyPageToken("SECRETO", f);
    const [url, init] = callsOf(f)[0];
    expect(url).toBe("https://graph.facebook.com/v24.0/me?fields=id,name");
    expect(String(url)).not.toContain("SECRETO");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer SECRETO");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("un error de Graph sale como texto, sin lanzar", async () => {
    const f = fetchReplies({ error: { code: 190, message: "Error validating access token" } }, false, 400);
    const out = await verifyPageToken("TOKEN", f);
    expect(out).toEqual({ ok: false, kind: "graph", error: "Graph 190: Error validating access token" });
  });

  it("si Graph repite el token en su mensaje, se tapa", async () => {
    const f = fetchReplies({ error: { code: 190, message: "Malformed access token EAAsecreto" } }, false, 400);
    const out = await verifyPageToken("EAAsecreto", f);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).not.toContain("EAAsecreto");
    expect(out.error).toContain("[token]");
  });

  it("una respuesta 200 sin id no se da por buena", async () => {
    const out = await verifyPageToken("TOKEN", fetchReplies({}));
    expect(out).toMatchObject({ ok: false, kind: "graph" });
  });

  it("un cuerpo que no es JSON no lanza", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    }) as unknown as typeof fetch;
    const out = await verifyPageToken("TOKEN", f);
    expect(out).toMatchObject({ ok: false, kind: "graph" });
  });

  it("una red caída no lanza y no filtra el token", async () => {
    const f = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED (TOKEN)")) as unknown as typeof fetch;
    const out = await verifyPageToken("TOKEN", f);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("network");
    expect(out.error).toContain("ECONNREFUSED");
    expect(out.error).not.toContain("TOKEN");
  });

  it("si Meta no contesta a tiempo, aborta y lo dice sin lanzar", async () => {
    // fetch que solo termina cuando la señal se aborta, como el real con Graph colgado.
    const f = vi.fn(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason));
        })
    ) as unknown as typeof fetch;
    const out = await verifyPageToken("TOKEN", f, 10);
    expect(out).toEqual({ ok: false, kind: "network", error: "Meta no respondió a tiempo" });
  });

  it("un id numérico se compara como texto", async () => {
    const out = await verifyPageToken("TOKEN", fetchReplies({ id: 2106777199430207, name: "Yaxnáh" }));
    expect(out).toMatchObject({ ok: true, pageId: "2106777199430207" });
  });
});

describe("pageMismatchMessage", () => {
  it("dice de qué página es el token y cuál esperaba la cuenta", () => {
    const msg = pageMismatchMessage({ pageId: "PAGE-2", pageName: "Yaxnáh" }, "PAGE-1");
    expect(msg).toContain("Este token es de la página «Yaxnáh» (PAGE-2), no de la de esta cuenta (PAGE-1)");
  });
});

describe("mergePageToken", () => {
  it("cambia solo el token y conserva el resto", () => {
    const before = { pageAccessToken: "viejo", appSecret: "APP", verifyToken: "VER" };
    expect(mergePageToken(before, "nuevo")).toEqual({ pageAccessToken: "nuevo", appSecret: "APP", verifyToken: "VER" });
    expect(before.pageAccessToken).toBe("viejo");
  });

  it("sin credenciales previas, solo el token", () => {
    expect(mergePageToken(null, "nuevo")).toEqual({ pageAccessToken: "nuevo" });
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";

// #961 — el hold dice POR QUÉ falló: un «no» del Hub (4xx) se respeta; no tener configurado el Hub
// o que no responda (red, 5xx) deja apartar de respaldo en el CRM.
vi.mock("@/lib/db", () => ({ default: { $queryRawUnsafe: vi.fn(async () => []) } }));

async function cliente(env: { base?: string; key?: string }) {
  vi.resetModules();
  process.env.HUB_API_BASE_URL = env.base ?? "";
  process.env.HUB_API_KEY = env.key ?? "";
  return import("./client");
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.HUB_API_BASE_URL;
  delete process.env.HUB_API_KEY;
});

const args = { hubUnitId: "u1", crmDealId: "d1" };

describe("requestUnitHold — motivo del fallo (#961)", () => {
  it("sin HUB_API_BASE_URL / HUB_API_KEY: sin_configurar, sin llamar a la red", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { requestUnitHold } = await cliente({});
    expect(await requestUnitHold(args)).toMatchObject({ ok: false, motivo: "sin_configurar" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("el Hub dice que no (409): rechazo, con su mensaje", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Unidad ya apartada" }), { status: 409 })));
    const { requestUnitHold } = await cliente({ base: "https://hub.example", key: "k" });
    expect(await requestUnitHold(args)).toEqual({ ok: false, motivo: "rechazo", error: "Unidad ya apartada" });
  });

  it("el Hub falla (502) o no hay red: sin_respuesta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    let c = await cliente({ base: "https://hub.example", key: "k" });
    expect(await c.requestUnitHold(args)).toMatchObject({ ok: false, motivo: "sin_respuesta", error: "Hub respondió 502" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    c = await cliente({ base: "https://hub.example", key: "k" });
    expect(await c.requestUnitHold(args)).toMatchObject({ ok: false, motivo: "sin_respuesta", error: "ECONNREFUSED" });
  });

  it("aparta: ok, a la URL y con la clave del Hub", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ unit: { id: "u1", status: "APARTADA", holdExpiresAt: null } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const { requestUnitHold } = await cliente({ base: "https://hub.example/", key: "k" });
    expect(await requestUnitHold(args)).toMatchObject({ ok: true, unit: { id: "u1" } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hub.example/api/inventory/units/u1/hold");
    expect((init.headers as Record<string, string>)["x-hub-api-key"]).toBe("k");
  });
});

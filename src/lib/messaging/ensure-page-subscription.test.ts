// ensurePageSubscription (2026-10-10): leer → suscribir lo que falta sin quitar lo que había
// → confirmar. Lo comparten «Suscribir página» y el alta de Meta DMs.
import { describe, it, expect, vi, beforeEach } from "vitest";

const probe = vi.fn();
const subscribe = vi.fn();
vi.mock("./webhook-subscription", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    probePageSubscription: (...a: unknown[]) => probe(...a),
    subscribePage: (...a: unknown[]) => subscribe(...a),
  };
});

import { ensurePageSubscription } from "./ensure-page-subscription";

const ALL = ["messages", "message_echoes", "feed"];

beforeEach(() => {
  probe.mockReset();
  subscribe.mockReset();
  subscribe.mockResolvedValue({ ok: true, error: null });
});

describe("ensurePageSubscription", () => {
  it("si ya tiene todo, no escribe en Meta", async () => {
    probe.mockResolvedValue({ subscribedFields: [...ALL, "leadgen"], error: null });
    expect(await ensurePageSubscription("PAGE-1", "TOKEN")).toEqual({
      ok: true, changed: false, subscribedFields: [...ALL, "leadgen"], missing: [],
    });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("agrega lo que falta sin quitar lo que había y devuelve lo que confirmó Meta", async () => {
    probe
      .mockResolvedValueOnce({ subscribedFields: ["leadgen"], error: null })
      .mockResolvedValueOnce({ subscribedFields: ["leadgen", ...ALL], error: null });
    const out = await ensurePageSubscription("PAGE-1", "TOKEN");
    expect(subscribe).toHaveBeenCalledWith("PAGE-1", "TOKEN", ["leadgen", ...ALL]);
    expect(out).toEqual({ ok: true, changed: true, subscribedFields: ["leadgen", ...ALL], missing: [] });
  });

  it("si no puede leer, no escribe a ciegas", async () => {
    probe.mockResolvedValue({ subscribedFields: [], error: "Graph 190: Token caducado" });
    expect(await ensurePageSubscription("PAGE-1", "TOKEN")).toEqual({
      ok: false, stage: "read", error: "Graph 190: Token caducado",
    });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("si Meta rechaza la suscripción, lo dice", async () => {
    probe.mockResolvedValue({ subscribedFields: [], error: null });
    subscribe.mockResolvedValue({ ok: false, error: "Graph 200: Requires pages_manage_metadata" });
    expect(await ensurePageSubscription("PAGE-1", "TOKEN")).toEqual({
      ok: false, stage: "subscribe", error: "Graph 200: Requires pages_manage_metadata",
    });
  });

  it("si falla la segunda lectura, informa lo que se mandó", async () => {
    probe
      .mockResolvedValueOnce({ subscribedFields: [], error: null })
      .mockResolvedValueOnce({ subscribedFields: [], error: "timeout" });
    expect(await ensurePageSubscription("PAGE-1", "TOKEN")).toEqual({
      ok: true, changed: true, subscribedFields: ALL, missing: [],
    });
  });

  it("si Meta aceptó pero aún falta un campo, lo reporta", async () => {
    probe
      .mockResolvedValueOnce({ subscribedFields: [], error: null })
      .mockResolvedValueOnce({ subscribedFields: ["messages"], error: null });
    const out = await ensurePageSubscription("PAGE-1", "TOKEN");
    expect(out).toMatchObject({ ok: true, missing: ["message_echoes", "feed"] });
  });
});

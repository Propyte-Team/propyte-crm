import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const connectorFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { leadConnector: { findFirst: (...a: unknown[]) => connectorFindFirst(...a) } },
}));

const getToken = vi.fn();
vi.mock("@/lib/messaging/social-accounts", () => ({
  getSocialPageToken: (...a: unknown[]) => getToken(...a),
}));

const probe = vi.fn();
const subscribe = vi.fn();
vi.mock("@/lib/messaging/webhook-subscription", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    probePageSubscription: (...a: unknown[]) => probe(...a),
    subscribePage: (...a: unknown[]) => subscribe(...a),
  };
});

import { POST } from "./route";

const call = () => POST({} as never, { params: Promise.resolve({ id: "c1" }) });

const YAXNAH = {
  id: "c1",
  name: "Messenger | DM Yaxnah",
  provider: "MESSENGER",
  config: { pageId: "PAGE-1" },
};

beforeEach(() => {
  for (const m of [connectorFindFirst, getToken, probe, subscribe]) m.mockReset();
  session.user.role = "ADMIN";
  connectorFindFirst.mockResolvedValue(YAXNAH);
  getToken.mockReturnValue("TOKEN");
  subscribe.mockResolvedValue({ ok: true, error: null });
});

describe("POST /api/admin/connectors/[id]/subscribe", () => {
  it("Página sin campos: suscribe los tres y devuelve lo que confirmó Meta", async () => {
    probe
      .mockResolvedValueOnce({ subscribedFields: [], error: null })
      .mockResolvedValueOnce({ subscribedFields: ["messages", "message_echoes", "feed"], error: null });
    const res = await call();
    expect(res.status).toBe(200);
    expect(subscribe).toHaveBeenCalledWith("PAGE-1", "TOKEN", ["messages", "message_echoes", "feed"]);
    expect((await res.json()).data).toEqual({
      changed: true,
      subscribedFields: ["messages", "message_echoes", "feed"],
      missing: [],
    });
  });

  it("no borra los campos que ya tenía la Página", async () => {
    probe.mockResolvedValue({ subscribedFields: ["leadgen", "messages"], error: null });
    await call();
    expect(subscribe).toHaveBeenCalledWith("PAGE-1", "TOKEN", ["leadgen", "messages", "message_echoes", "feed"]);
  });

  it("si ya tiene todo, no escribe en Meta", async () => {
    probe.mockResolvedValue({ subscribedFields: ["messages", "message_echoes", "feed"], error: null });
    const body = await (await call()).json();
    expect(body.data.changed).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("si no puede leer la Página, no escribe a ciegas", async () => {
    probe.mockResolvedValue({ subscribedFields: [], error: "Graph 190: Token caducado" });
    const res = await call();
    expect(res.status).toBe(502);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("si Meta rechaza, devuelve su error", async () => {
    probe.mockResolvedValue({ subscribedFields: [], error: null });
    subscribe.mockResolvedValue({ ok: false, error: "Graph 200: Requires pages_manage_metadata" });
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("pages_manage_metadata");
  });

  it("la respuesta nunca incluye el token", async () => {
    probe.mockResolvedValue({ subscribedFields: [], error: null });
    const text = JSON.stringify(await (await call()).json());
    expect(text).not.toContain("TOKEN");
  });

  it("sin token no llama a Meta", async () => {
    getToken.mockReturnValue(null);
    const res = await call();
    expect(res.status).toBe(400);
    expect(probe).not.toHaveBeenCalled();
  });

  it("cuenta inexistente o que no es social: 404", async () => {
    connectorFindFirst.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  it("MARKETING puede suscribir sus cuentas", async () => {
    session.user.role = "MARKETING";
    probe.mockResolvedValue({ subscribedFields: ["messages", "message_echoes", "feed"], error: null });
    expect((await call()).status).toBe(200);
  });

  it("un rol de venta sigue fuera", async () => {
    session.user.role = "ASESOR";
    expect((await call()).status).toBe(403);
    expect(connectorFindFirst).not.toHaveBeenCalled();
  });
});

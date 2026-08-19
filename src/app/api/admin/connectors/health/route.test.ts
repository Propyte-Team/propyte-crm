import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const connectorFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { leadConnector: { findMany: (...a: unknown[]) => connectorFindMany(...a) } },
}));

vi.mock("@/lib/messaging/connector-health", () => ({
  checkSocialConnector: () => ({ ok: true, missing: [] }),
}));

const getToken = vi.fn();
vi.mock("@/lib/messaging/social-accounts", () => ({
  getSocialPageToken: (...a: unknown[]) => getToken(...a),
}));

const probe = vi.fn();
vi.mock("@/lib/messaging/webhook-subscription", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, probePageSubscription: (...a: unknown[]) => probe(...a) };
});

import { GET } from "./route";

function req(query = "") {
  return new NextRequestLike(`http://t/api/admin/connectors/health${query}`) as never;
}

// El route usa req.nextUrl; en test basta un objeto con esa forma.
class NextRequestLike {
  nextUrl: URL;
  constructor(url: string) {
    this.nextUrl = new URL(url);
  }
}

const MESSENGER = {
  id: "c1",
  name: "Messenger | DM Propyte",
  provider: "MESSENGER",
  status: "ACTIVE",
  config: { pageId: "PAGE-1" },
};

beforeEach(() => {
  for (const m of [connectorFindMany, getToken, probe]) m.mockReset();
  session.user.role = "ADMIN";
  connectorFindMany.mockResolvedValue([MESSENGER]);
  getToken.mockReturnValue("TOKEN");
  probe.mockResolvedValue({ subscribedFields: ["messages", "feed"], error: null });
});

describe("GET /api/admin/connectors/health", () => {
  it("sin ?probe=1 no llama a Meta", async () => {
    const res = await GET(req());
    expect((await res.json()).data[0].webhook).toBeUndefined();
    expect(probe).not.toHaveBeenCalled();
  });

  it("con ?probe=1 reporta los campos suscritos de la Página", async () => {
    const res = await GET(req("?probe=1"));
    expect((await res.json()).data[0].webhook).toEqual({
      subscribedFields: ["messages", "feed"],
      missingForComments: [],
      error: null,
    });
  });

  it("delata la Página sin `feed`: sus comentarios nunca llegan", async () => {
    probe.mockResolvedValue({ subscribedFields: ["messages"], error: null });
    const res = await GET(req("?probe=1"));
    expect((await res.json()).data[0].webhook.missingForComments).toEqual(["feed"]);
  });

  it("no inventa faltantes cuando Graph falló", async () => {
    probe.mockResolvedValue({ subscribedFields: [], error: "Graph 190: Token caducado" });
    const body = await (await GET(req("?probe=1"))).json();
    expect(body.data[0].webhook.missingForComments).toEqual([]);
    expect(body.data[0].webhook.error).toContain("190");
  });

  it("en Instagram no evalúa `feed`: sus comentarios no vienen por la Página", async () => {
    connectorFindMany.mockResolvedValue([{ ...MESSENGER, provider: "INSTAGRAM" }]);
    probe.mockResolvedValue({ subscribedFields: [], error: null });
    const body = await (await GET(req("?probe=1"))).json();
    expect(body.data[0].webhook.missingForComments).toEqual([]);
  });

  it("sin token no llama a Meta y lo dice", async () => {
    getToken.mockReturnValue(null);
    const body = await (await GET(req("?probe=1"))).json();
    expect(body.data[0].webhook.error).toContain("token");
    expect(probe).not.toHaveBeenCalled();
  });

  it("MARKETING puede consultarlo: son sus propias cuentas", async () => {
    session.user.role = "MARKETING";
    expect((await GET(req())).status).toBe(200);
  });

  it("un rol de venta sigue fuera", async () => {
    session.user.role = "ASESOR";
    expect((await GET(req())).status).toBe(403);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const blockedFindUnique = vi.fn();
const connFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    blockedSender: { findUnique: (...a: unknown[]) => blockedFindUnique(...a) },
    leadConnector: { findFirst: (...a: unknown[]) => connFindFirst(...a) },
  },
}));

const blockOnMeta = vi.fn();
vi.mock("@/lib/moderation/meta-moderation", () => ({
  blockOnMeta: (...a: unknown[]) => blockOnMeta(...a),
}));

const recordMetaResult = vi.fn();
vi.mock("@/lib/moderation/block-sender", () => ({
  recordMetaResult: (...a: unknown[]) => recordMetaResult(...a),
}));

vi.mock("@/lib/messaging/social-accounts", () => ({ getSocialPageToken: () => "TOKEN" }));

import { POST } from "./route";

const PARAMS = { params: { id: "blocked-1" } };
const request = () => new Request("http://x", { method: "POST" }) as never;

beforeEach(() => {
  [getServerSession, blockedFindUnique, connFindFirst, blockOnMeta, recordMetaResult].forEach((m) => m.mockReset());
  getServerSession.mockResolvedValue({ user: { id: "user-1", role: "ADMIN" } });
  blockedFindUnique.mockResolvedValue({
    id: "blocked-1",
    channel: "INSTAGRAM",
    identifier: "IGSID-1",
    unblockedAt: null,
  });
  connFindFirst.mockResolvedValue({ id: "conn-ig", config: { pageId: "PAGE-1" } });
  blockOnMeta.mockResolvedValue({ blockStatus: "SENT", spamStatus: "SENT" });
});

describe("POST retry", () => {
  it("403 si el rol no puede", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u", role: "ASESOR" } });
    expect((await POST(request(), PARAMS)).status).toBe(403);
    expect(blockOnMeta).not.toHaveBeenCalled();
  });

  it("404 si no existe", async () => {
    blockedFindUnique.mockResolvedValue(null);
    expect((await POST(request(), PARAMS)).status).toBe(404);
  });

  it("409 si ya está desbloqueado — no se reintenta un bloqueo que se deshizo", async () => {
    blockedFindUnique.mockResolvedValue({
      id: "blocked-1", channel: "INSTAGRAM", identifier: "IGSID-1", unblockedAt: new Date("2026-08-05T00:00:00Z"),
    });
    expect((await POST(request(), PARAMS)).status).toBe(409);
    expect(blockOnMeta).not.toHaveBeenCalled();
  });

  it("reintenta con el conector del canal y guarda el resultado", async () => {
    const res = await POST(request(), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { meta: { blockStatus: "SENT", spamStatus: "SENT" } } });
    expect(blockOnMeta).toHaveBeenCalledWith({
      channel: "INSTAGRAM", pageId: "PAGE-1", token: "TOKEN", identifier: "IGSID-1",
    });
    expect(recordMetaResult).toHaveBeenCalledWith("blocked-1", { blockStatus: "SENT", spamStatus: "SENT" });
  });

  it("sin conector activo, pageId y token van en null y se registra igual", async () => {
    connFindFirst.mockResolvedValue(null);
    blockOnMeta.mockResolvedValue({ blockStatus: "SKIPPED", spamStatus: "SKIPPED", error: "conector sin pageAccessToken" });
    const res = await POST(request(), PARAMS);
    expect(res.status).toBe(200);
    expect(blockOnMeta).toHaveBeenCalledWith({
      channel: "INSTAGRAM", pageId: null, token: null, identifier: "IGSID-1",
    });
    expect(recordMetaResult).toHaveBeenCalled();
  });
});

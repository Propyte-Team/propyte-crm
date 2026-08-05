import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const blockedFindUnique = vi.fn();
const blockedUpdate = vi.fn();
const contactUpdate = vi.fn();
const connFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    blockedSender: {
      findUnique: (...a: unknown[]) => blockedFindUnique(...a),
      update: (...a: unknown[]) => blockedUpdate(...a),
    },
    contact: { update: (...a: unknown[]) => contactUpdate(...a) },
    leadConnector: { findFirst: (...a: unknown[]) => connFindFirst(...a) },
  },
}));

const unblockOnMeta = vi.fn();
vi.mock("@/lib/moderation/meta-moderation", () => ({
  unblockOnMeta: (...a: unknown[]) => unblockOnMeta(...a),
}));

vi.mock("@/lib/messaging/social-accounts", () => ({ getSocialPageToken: () => "TOKEN" }));

import { POST } from "./route";

const PARAMS = { params: { id: "blocked-1" } };
const request = () => new Request("http://x", { method: "POST" }) as never;

beforeEach(() => {
  [getServerSession, blockedFindUnique, blockedUpdate, contactUpdate, connFindFirst, unblockOnMeta].forEach((m) =>
    m.mockReset()
  );
  getServerSession.mockResolvedValue({ user: { id: "user-1", role: "ADMIN" } });
  blockedFindUnique.mockResolvedValue({
    id: "blocked-1",
    channel: "INSTAGRAM",
    identifier: "IGSID-1",
    contactId: "contact-1",
    unblockedAt: null,
  });
  connFindFirst.mockResolvedValue(null);
  unblockOnMeta.mockResolvedValue({ ok: true });
  blockedUpdate.mockResolvedValue({});
  contactUpdate.mockResolvedValue({});
});

describe("POST unblock", () => {
  it("403 si el rol no puede", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u", role: "ASESOR" } });
    expect((await POST(request(), PARAMS)).status).toBe(403);
  });

  it("404 si no existe", async () => {
    blockedFindUnique.mockResolvedValue(null);
    expect((await POST(request(), PARAMS)).status).toBe(404);
  });

  it("marca unblockedAt y reactiva el contacto", async () => {
    const res = await POST(request(), PARAMS);
    expect(res.status).toBe(200);

    expect(blockedUpdate.mock.calls[0][0].where).toEqual({ id: "blocked-1" });
    expect(blockedUpdate.mock.calls[0][0].data.unblockedAt).toBeInstanceOf(Date);

    expect(contactUpdate).toHaveBeenCalledWith({
      where: { id: "contact-1" },
      data: { deletedAt: null, doNotContact: false },
    });
  });

  it("no toca el contacto si el bloqueo no tenía contactId", async () => {
    blockedFindUnique.mockResolvedValue({
      id: "blocked-1", channel: "INSTAGRAM", identifier: "IGSID-1", contactId: null, unblockedAt: null,
    });
    await POST(request(), PARAMS);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("avisa de que la PII no vuelve", async () => {
    const body = await (await POST(request(), PARAMS)).json();
    expect(body.data.aviso).toContain("datos personales");
  });
});

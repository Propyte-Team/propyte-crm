import { describe, it, expect, vi, beforeEach } from "vitest";

const convFindUnique = vi.fn();
const dealCount = vi.fn();
const walkInCount = vi.fn();
const blockedUpsert = vi.fn();
const contactUpdate = vi.fn();
const convUpdate = vi.fn();
const blockedUpdate = vi.fn();

const tx = {
  blockedSender: {
    upsert: (...a: unknown[]) => blockedUpsert(...a),
    update: (...a: unknown[]) => blockedUpdate(...a),
  },
  contact: { update: (...a: unknown[]) => contactUpdate(...a) },
  conversation: { update: (...a: unknown[]) => convUpdate(...a) },
};

vi.mock("@/lib/db", () => ({
  default: {
    conversation: { findUnique: (...a: unknown[]) => convFindUnique(...a) },
    deal: { count: (...a: unknown[]) => dealCount(...a) },
    walkIn: { count: (...a: unknown[]) => walkInCount(...a) },
    blockedSender: { update: (...a: unknown[]) => blockedUpdate(...a) },
  },
}));

vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_opts: unknown, fn: (t: unknown) => Promise<unknown>) => fn(tx),
}));

import { markConversationAsSpam } from "./block-sender";

const CONV = {
  id: "conv-1",
  channel: "INSTAGRAM",
  connectorId: "conn-ig",
  contact: {
    id: "contact-1",
    instagramId: "IGSID-1",
    messengerPsid: null,
    phone: null,
    tags: ["lead"],
  },
};

beforeEach(() => {
  [convFindUnique, dealCount, walkInCount, blockedUpsert, contactUpdate, convUpdate, blockedUpdate].forEach((m) =>
    m.mockReset()
  );
  convFindUnique.mockResolvedValue(CONV);
  dealCount.mockResolvedValue(0);
  walkInCount.mockResolvedValue(0);
  blockedUpsert.mockResolvedValue({ id: "blocked-1" });
});

describe("markConversationAsSpam — salvaguardas", () => {
  it("404 si la conversación no existe", async () => {
    convFindUnique.mockResolvedValue(null);
    const res = await markConversationAsSpam({ conversationId: "nope", actorId: "user-1" });
    expect(res).toEqual({ ok: false, code: "no-existe" });
  });

  it("aborta si el contacto tiene deals", async () => {
    dealCount.mockResolvedValue(2);
    const res = await markConversationAsSpam({ conversationId: "conv-1", actorId: "user-1" });
    expect(res).toEqual({ ok: false, code: "tiene-negocio", deals: 2, walkIns: 0 });
    expect(blockedUpsert).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("aborta si el contacto tiene walk-ins", async () => {
    walkInCount.mockResolvedValue(1);
    const res = await markConversationAsSpam({ conversationId: "conv-1", actorId: "user-1" });
    expect(res).toEqual({ ok: false, code: "tiene-negocio", deals: 0, walkIns: 1 });
  });

  it("aborta si el canal no tiene identificador bloqueable", async () => {
    convFindUnique.mockResolvedValue({ ...CONV, channel: "WEB" });
    const res = await markConversationAsSpam({ conversationId: "conv-1", actorId: "user-1" });
    expect(res).toEqual({ ok: false, code: "sin-identificador" });
  });

  it("aborta si el contacto no tiene el id social del canal", async () => {
    convFindUnique.mockResolvedValue({ ...CONV, contact: { ...CONV.contact, instagramId: null } });
    const res = await markConversationAsSpam({ conversationId: "conv-1", actorId: "user-1" });
    expect(res).toEqual({ ok: false, code: "sin-identificador" });
  });
});

describe("markConversationAsSpam — la transacción", () => {
  it("da de alta el bloqueo, anonimiza el contacto y cierra el hilo", async () => {
    const res = await markConversationAsSpam({
      conversationId: "conv-1",
      actorId: "user-1",
      reason: "spam de cripto",
    });

    expect(res).toEqual({
      ok: true,
      blockedSenderId: "blocked-1",
      channel: "INSTAGRAM",
      identifier: "IGSID-1",
      connectorId: "conn-ig",
    });

    expect(blockedUpsert).toHaveBeenCalledWith({
      where: { channel_identifier: { channel: "INSTAGRAM", identifier: "IGSID-1" } },
      create: {
        channel: "INSTAGRAM",
        identifier: "IGSID-1",
        reason: "spam de cripto",
        blockedById: "user-1",
        contactId: "contact-1",
      },
      update: {
        reason: "spam de cripto",
        blockedById: "user-1",
        contactId: "contact-1",
        unblockedAt: null,
        metaBlockStatus: "PENDING",
        metaSpamStatus: "PENDING",
        metaError: null,
      },
      select: { id: true },
    });

    const contactArgs = contactUpdate.mock.calls[0][0];
    expect(contactArgs.where).toEqual({ id: "contact-1" });
    expect(contactArgs.data).toMatchObject({
      email: null,
      phone: null,
      secondaryPhone: null,
      instagramId: null,
      messengerPsid: null,
      contactStatus: "DESCARTADO",
      doNotContact: true,
    });
    expect(contactArgs.data.firstName).toBe("Spam");
    expect(contactArgs.data.tags).toEqual(["lead", "SPAM"]);
    expect(contactArgs.data.deletedAt).toBeInstanceOf(Date);

    expect(convUpdate).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { status: "CLOSED", botEnabled: false, unreadCount: 0, controlledById: null },
    });
  });

  it("no duplica la etiqueta SPAM si ya estaba", async () => {
    convFindUnique.mockResolvedValue({ ...CONV, contact: { ...CONV.contact, tags: ["SPAM"] } });
    await markConversationAsSpam({ conversationId: "conv-1", actorId: "user-1" });
    expect(contactUpdate.mock.calls[0][0].data.tags).toEqual(["SPAM"]);
  });
});

describe("recordMetaResult", () => {
  it("guarda el estado devuelto por Meta", async () => {
    const { recordMetaResult } = await import("./block-sender");
    blockedUpdate.mockResolvedValue({});
    await recordMetaResult("blocked-1", { blockStatus: "SENT", spamStatus: "FAILED", error: "boom" });
    expect(blockedUpdate).toHaveBeenCalledWith({
      where: { id: "blocked-1" },
      data: { metaBlockStatus: "SENT", metaSpamStatus: "FAILED", metaError: "boom" },
    });
  });

  it("no lanza si la escritura falla", async () => {
    const { recordMetaResult } = await import("./block-sender");
    blockedUpdate.mockRejectedValue(new Error("db caída"));
    await expect(
      recordMetaResult("blocked-1", { blockStatus: "SENT", spamStatus: "SENT" })
    ).resolves.toBeUndefined();
  });
});

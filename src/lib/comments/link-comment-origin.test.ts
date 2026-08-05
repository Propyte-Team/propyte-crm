import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindFirst = vi.fn();
const logFindFirst = vi.fn();
const logUpdate = vi.fn();
const messageCreate = vi.fn();
const conversationUpdate = vi.fn();
const activityCreate = vi.fn();
const userFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findFirst: (...a: unknown[]) => contactFindFirst(...a) },
    commentRuleLog: {
      findFirst: (...a: unknown[]) => logFindFirst(...a),
      update: (...a: unknown[]) => logUpdate(...a),
    },
    message: { create: (...a: unknown[]) => messageCreate(...a) },
    conversation: { update: (...a: unknown[]) => conversationUpdate(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
  },
}));

const ensureConversation = vi.fn();
vi.mock("@/lib/messaging/conversations", () => ({
  ensureConversation: (...a: unknown[]) => ensureConversation(...a),
}));

import { persistOpenerForKnownContact, linkCommentOrigin } from "./link-comment-origin";

beforeEach(() => {
  for (const m of [
    contactFindFirst, logFindFirst, logUpdate, messageCreate,
    conversationUpdate, activityCreate, userFindFirst, ensureConversation,
  ]) m.mockReset();
  ensureConversation.mockResolvedValue({ id: "conv-1", status: "BOT" });
  messageCreate.mockResolvedValue({ id: "msg-1" });
  userFindFirst.mockResolvedValue({ id: "admin-1" });
});

describe("persistOpenerForKnownContact", () => {
  const args = {
    platform: "INSTAGRAM" as const,
    connectorId: "conn-ig",
    recipientId: "IGSID-1",
    text: "Hola, aquí va la info",
    externalMessageId: "mid-1",
  };

  it("desconocido: no crea nada (el contacto nace cuando responde)", async () => {
    contactFindFirst.mockResolvedValue(null);
    expect(await persistOpenerForKnownContact(args)).toBeNull();
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("conocido: guarda el opener como BOT y NO toca el status de la conversación", async () => {
    contactFindFirst.mockResolvedValue({ id: "c-1", assignedToId: "u-1" });
    await persistOpenerForKnownContact(args);
    expect(messageCreate.mock.calls[0][0].data).toMatchObject({
      contactId: "c-1",
      channel: "INSTAGRAM",
      direction: "OUTBOUND",
      sender: "BOT",
      aiGenerated: false,
      body: "Hola, aquí va la info",
      externalMessageId: "mid-1",
      conversationId: "conv-1",
      status: "SENT",
    });
    const convData = conversationUpdate.mock.calls[0][0].data;
    expect(convData).not.toHaveProperty("status");
    expect(convData).not.toHaveProperty("unreadCount");
  });

  it("busca por instagramId en IG y por messengerPsid en Facebook", async () => {
    contactFindFirst.mockResolvedValue(null);
    await persistOpenerForKnownContact(args);
    expect(contactFindFirst.mock.calls[0][0].where).toMatchObject({ instagramId: "IGSID-1" });

    contactFindFirst.mockClear();
    await persistOpenerForKnownContact({ ...args, platform: "FACEBOOK" });
    expect(contactFindFirst.mock.calls[0][0].where).toMatchObject({ messengerPsid: "IGSID-1" });
  });

  it("mid repetido (P2002) no revienta: el eco ya lo había guardado", async () => {
    contactFindFirst.mockResolvedValue({ id: "c-1", assignedToId: null });
    messageCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(persistOpenerForKnownContact(args)).resolves.toBeNull();
  });
});

describe("linkCommentOrigin", () => {
  it("sin log pendiente para ese remitente no hace nada", async () => {
    logFindFirst.mockResolvedValue(null);
    expect(await linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1")).toBeNull();
    expect(logUpdate).not.toHaveBeenCalled();
  });

  it("estampa contactId en el log del comentario", async () => {
    logFindFirst.mockResolvedValue({
      id: "log-1", connectorId: "conn-ig", postId: "MEDIA-1", matchedPhrase: "info",
      dmText: "Hola, info", dmExternalMessageId: "mid-1", dmStatus: "SENT", createdAt: new Date("2026-08-04T10:00:00Z"),
    });
    await linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1");
    expect(logUpdate).toHaveBeenCalledWith({ where: { id: "log-1" }, data: { contactId: "c-1" } });
  });

  it("rellena el opener con el createdAt del log para que quede ANTES de la respuesta", async () => {
    const logCreatedAt = new Date("2026-08-04T10:00:00Z");
    logFindFirst.mockResolvedValue({
      id: "log-1", connectorId: "conn-ig", postId: "MEDIA-1", matchedPhrase: "info",
      dmText: "Hola, info", dmExternalMessageId: "mid-1", dmStatus: "SENT", createdAt: logCreatedAt,
    });
    await linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1");
    expect(messageCreate.mock.calls[0][0].data).toMatchObject({
      sender: "BOT",
      direction: "OUTBOUND",
      body: "Hola, info",
      externalMessageId: "mid-1",
      createdAt: logCreatedAt,
    });
  });

  it("registra la actividad del origen", async () => {
    logFindFirst.mockResolvedValue({
      id: "log-1", connectorId: "conn-ig", postId: "MEDIA-1", matchedPhrase: "info",
      dmText: "Hola", dmExternalMessageId: "mid-1", dmStatus: "SENT", createdAt: new Date(),
    });
    await linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1");
    expect(activityCreate.mock.calls[0][0].data).toMatchObject({
      contactId: "c-1",
      activityType: "NOTE",
      status: "COMPLETADA",
    });
    expect(activityCreate.mock.calls[0][0].data.subject).toContain("MEDIA-1");
    expect(activityCreate.mock.calls[0][0].data.description).toContain("info");
  });

  it("es idempotente: segunda pasada no vuelve a crear el opener", async () => {
    logFindFirst.mockResolvedValue(null); // ya tiene contactId, el filtro no lo trae
    await linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1");
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("un fallo al rellenar el opener no impide estampar el contactId", async () => {
    logFindFirst.mockResolvedValue({
      id: "log-1", connectorId: "conn-ig", postId: "MEDIA-1", matchedPhrase: "info",
      dmText: "Hola", dmExternalMessageId: "mid-1", dmStatus: "SENT", createdAt: new Date(),
    });
    ensureConversation.mockRejectedValue(new Error("boom"));
    await expect(linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1")).resolves.not.toThrow();
    expect(logUpdate).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindFirst = vi.fn();
const logFindFirst = vi.fn();
const logUpdate = vi.fn();
const logUpdateMany = vi.fn();
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
      updateMany: (...a: unknown[]) => logUpdateMany(...a),
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

const captureLead = vi.fn();
vi.mock("@/lib/intake/capture-lead", () => ({
  captureLead: (...a: unknown[]) => captureLead(...a),
}));

import { persistOpenerCreatingContact, linkCommentOrigin } from "./link-comment-origin";
import { PLACEHOLDER_LASTNAME } from "@/lib/messaging/types";

beforeEach(() => {
  for (const m of [
    contactFindFirst, logFindFirst, logUpdate, logUpdateMany, messageCreate,
    conversationUpdate, activityCreate, userFindFirst, ensureConversation, captureLead,
  ]) m.mockReset();
  ensureConversation.mockResolvedValue({ id: "conv-1", status: "BOT" });
  messageCreate.mockResolvedValue({ id: "msg-1" });
  userFindFirst.mockResolvedValue({ id: "admin-1" });
  logUpdateMany.mockResolvedValue({ count: 1 });
  captureLead.mockResolvedValue({ contactId: "c-new", isNew: true, assignedToId: "u-9" });
});

describe("persistOpenerCreatingContact", () => {
  const args = {
    logId: "log-1",
    platform: "INSTAGRAM" as const,
    connectorId: "conn-ig",
    recipientId: "IGSID-1",
    authorHandle: "luisf",
    postId: "MEDIA-1",
    matchedPhrase: "info",
    text: "Hola, aquí va la info",
    externalMessageId: "mid-1",
  };

  it("conocido: guarda el opener como BOT y NO toca el status de la conversación", async () => {
    contactFindFirst.mockResolvedValue({ id: "c-1", assignedToId: "u-1" });
    await persistOpenerCreatingContact(args);
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

  it("conocido: NO llama a captureLead (el camino de siempre queda intacto)", async () => {
    contactFindFirst.mockResolvedValue({ id: "c-1", assignedToId: "u-1" });
    const out = await persistOpenerCreatingContact(args);
    expect(captureLead).not.toHaveBeenCalled();
    expect(out).toEqual({ contactId: "c-1", isNewContact: false, conversationId: "conv-1" });
  });

  it("busca por instagramId en IG y por messengerPsid en Facebook", async () => {
    contactFindFirst.mockResolvedValue({ id: "c-1", assignedToId: null });
    await persistOpenerCreatingContact(args);
    expect(contactFindFirst.mock.calls[0][0].where).toMatchObject({ instagramId: "IGSID-1" });

    contactFindFirst.mockClear();
    await persistOpenerCreatingContact({ ...args, platform: "FACEBOOK" });
    expect(contactFindFirst.mock.calls[0][0].where).toMatchObject({ messengerPsid: "IGSID-1" });
  });

  // Fix 4 (code review): ensureConversation está mockeado y devuelve siempre
  // {id: "conv-1"} sin importar los argumentos — nada verificaba lo que se le
  // pasa. Si alguien invierte el mapeo CHANNEL (INSTAGRAM<->MESSENGER), estos
  // tests deben gritar.
  it("Fix 4: INSTAGRAM mapea a channel INSTAGRAM en ensureConversation, con el connectorId correcto", async () => {
    contactFindFirst.mockResolvedValue({ id: "c-1", assignedToId: "u-1" });
    await persistOpenerCreatingContact(args);
    expect(ensureConversation.mock.calls[0][0]).toMatchObject({
      channel: "INSTAGRAM",
      connectorId: "conn-ig",
    });
  });

  it("Fix 4: FACEBOOK mapea a channel MESSENGER en ensureConversation, con el connectorId correcto", async () => {
    contactFindFirst.mockResolvedValue({ id: "c-1", assignedToId: "u-1" });
    await persistOpenerCreatingContact({ ...args, platform: "FACEBOOK" });
    expect(ensureConversation.mock.calls[0][0]).toMatchObject({
      channel: "MESSENGER",
      connectorId: "conn-ig",
    });
  });

  it("mid repetido (P2002) no revienta: el eco ya lo había guardado", async () => {
    contactFindFirst.mockResolvedValue({ id: "c-1", assignedToId: null });
    messageCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(persistOpenerCreatingContact(args)).resolves.toMatchObject({
      contactId: "c-1",
      conversationId: null,
    });
  });

  // --- Cambio de producto 2026-08-06: el hilo nace con el envío ---

  describe("desconocido: el contacto se crea en el momento del envío", () => {
    beforeEach(() => {
      contactFindFirst.mockResolvedValue(null);
    });

    // Sin `message`: el contact.create del alta no lo referencia y la rama de
    // captureLead que sí lo usa (duplicado) es inalcanzable desde aquí.
    it("llama a captureLead con el handle, el placeholder de apellido y el connectorId", async () => {
      await persistOpenerCreatingContact(args);
      expect(captureLead).toHaveBeenCalledWith(
        {
          source: "INSTAGRAM",
          firstName: "luisf",
          lastName: PLACEHOLDER_LASTNAME,
          instagramId: "IGSID-1",
        },
        { connectorId: "conn-ig" }
      );
    });

    it("Facebook: source MESSENGER y messengerPsid", async () => {
      await persistOpenerCreatingContact({ ...args, platform: "FACEBOOK" });
      expect(captureLead.mock.calls[0][0]).toMatchObject({
        source: "MESSENGER",
        messengerPsid: "IGSID-1",
      });
    });

    it("sin handle usa el nombre por defecto del canal, igual que el intake", async () => {
      await persistOpenerCreatingContact({ ...args, authorHandle: null });
      expect(captureLead.mock.calls[0][0].firstName).toBe("Instagram");

      captureLead.mockClear();
      await persistOpenerCreatingContact({ ...args, platform: "FACEBOOK", authorHandle: "  " });
      expect(captureLead.mock.calls[0][0].firstName).toBe("Messenger");
    });

    it("la arroba del handle no llega al nombre del contacto", async () => {
      await persistOpenerCreatingContact({ ...args, authorHandle: "@luisf" });
      expect(captureLead.mock.calls[0][0].firstName).toBe("luisf");
    });

    it("crea el opener con el mid del DM sobre el contacto recién creado", async () => {
      const out = await persistOpenerCreatingContact(args);
      expect(messageCreate.mock.calls[0][0].data).toMatchObject({
        contactId: "c-new",
        userId: "u-9",
        sender: "BOT",
        aiGenerated: false,
        externalMessageId: "mid-1",
      });
      expect(out).toEqual({ contactId: "c-new", isNewContact: true, conversationId: "conv-1" });
    });

    it("estampa el contactId en el log en el momento del envío", async () => {
      await persistOpenerCreatingContact(args);
      expect(logUpdateMany).toHaveBeenCalledWith({
        where: { id: "log-1", contactId: null },
        data: { contactId: "c-new" },
      });
    });

    it("crea la nota de origen con la misma redacción, atribuida al asesor asignado", async () => {
      await persistOpenerCreatingContact(args);
      const data = activityCreate.mock.calls[0][0].data;
      expect(data).toMatchObject({
        contactId: "c-new",
        userId: "u-9",
        activityType: "NOTE",
        status: "COMPLETADA",
      });
      expect(data.subject).toContain("MEDIA-1");
      expect(data.description).toContain("info");
    });

    it("sin asesor asignado la nota se atribuye a un ADMIN activo", async () => {
      captureLead.mockResolvedValue({ contactId: "c-new", isNew: true, assignedToId: null });
      await persistOpenerCreatingContact(args);
      expect(userFindFirst).toHaveBeenCalledWith({
        where: { role: "ADMIN", isActive: true },
        select: { id: true },
      });
      expect(activityCreate.mock.calls[0][0].data.userId).toBe("admin-1");
    });

    it("captureLead no capturable: no revienta, no escribe opener ni estampa el log", async () => {
      captureLead.mockResolvedValue({
        contactId: null, isNew: false, assignedToId: null, error: "sin identificador",
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(persistOpenerCreatingContact(args)).resolves.toBeNull();
      expect(messageCreate).not.toHaveBeenCalled();
      expect(logUpdateMany).not.toHaveBeenCalled();
      expect(activityCreate).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    // captureLead también puede LANZAR. Caso concreto: un contacto
    // soft-deleted o mergeado que conserve este instagramId es invisible para
    // los dos dedups (ambos filtran deletedAt null / mergedIntoId null) pero
    // sigue ocupando el índice único → P2002 en contact.create.
    it("captureLead lanza (P2002 de un contacto borrado que ocupa el índice): degrada igual, no revienta", async () => {
      captureLead.mockRejectedValue(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(persistOpenerCreatingContact(args)).resolves.toBeNull();
      expect(messageCreate).not.toHaveBeenCalled();
      expect(logUpdateMany).not.toHaveBeenCalled();
      expect(activityCreate).not.toHaveBeenCalled();
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });

    // Si el opener revienta por un blip de la base, el log NO debe quedar
    // estampado: linkCommentOrigin es el repesque cuando la persona responda.
    it("si el opener revienta, el error sube (handle-comment lo captura) y el log queda sin estampar", async () => {
      ensureConversation.mockRejectedValue(new Error("boom"));
      await expect(persistOpenerCreatingContact(args)).rejects.toThrow("boom");
      expect(logUpdateMany).not.toHaveBeenCalled();
    });

    // El candado del updateMany es lo que garantiza UNA sola nota de origen.
    it("si otro camino ya reclamó el log (count 0), no crea una segunda nota de origen", async () => {
      logUpdateMany.mockResolvedValue({ count: 0 });
      await persistOpenerCreatingContact(args);
      expect(messageCreate).toHaveBeenCalled();
      expect(activityCreate).not.toHaveBeenCalled();
    });
  });
});

describe("linkCommentOrigin", () => {
  // Camino heredado: sigue vivo para los logs que quedaron con contactId null
  // antes del cambio del 2026-08-06 (3 en prod) y para los que no se pudieron
  // estampar en el envío.
  const OLD_LOG = {
    id: "log-1", connectorId: "conn-ig", postId: "MEDIA-1", matchedPhrase: "info",
    dmText: "Hola, info", dmExternalMessageId: "mid-1", dmStatus: "SENT",
    createdAt: new Date("2026-08-04T10:00:00Z"),
  };

  it("sin log pendiente para ese remitente no hace nada", async () => {
    logFindFirst.mockResolvedValue(null);
    expect(await linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1")).toBeNull();
    expect(logUpdateMany).not.toHaveBeenCalled();
  });

  it("estampa contactId en el log del comentario vía updateMany condicionado a contactId: null", async () => {
    logFindFirst.mockResolvedValue(OLD_LOG);
    await linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1");
    expect(logUpdateMany).toHaveBeenCalledWith({
      where: { id: "log-1", contactId: null },
      data: { contactId: "c-1" },
    });
  });

  // Fix 2 (code review): findFirst + update no era atómico. Dos inbounds casi
  // simultáneos del mismo remitente (reintento del webhook de Meta, o dos
  // mensajes seguidos) podían pasar los dos el findFirst antes de que cualquiera
  // actualizara. El opener está protegido por el índice único de
  // externalMessageId, pero activity.create no tenía ninguna protección: se
  // creaban dos notas idénticas "Origen: comentario…" en la cronología del
  // contacto. El updateMany condicionado a contactId: null es el candado
  // atómico, sin necesidad de transacción.
  it("Fix 2: carrera — otro inbound concurrente ya reclamó el log (updateMany count 0) → no crea opener ni actividad, devuelve null", async () => {
    logFindFirst.mockResolvedValue(OLD_LOG);
    logUpdateMany.mockResolvedValue({ count: 0 });
    expect(await linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1")).toBeNull();
    expect(messageCreate).not.toHaveBeenCalled();
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it("rellena el opener con el createdAt del log para que quede ANTES de la respuesta", async () => {
    logFindFirst.mockResolvedValue(OLD_LOG);
    await linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1");
    expect(messageCreate.mock.calls[0][0].data).toMatchObject({
      sender: "BOT",
      direction: "OUTBOUND",
      body: "Hola, info",
      externalMessageId: "mid-1",
      createdAt: OLD_LOG.createdAt,
    });
  });

  it("registra la actividad del origen", async () => {
    logFindFirst.mockResolvedValue(OLD_LOG);
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

  // El log que persistOpenerCreatingContact ya estampó al enviar no vuelve a
  // entrar aquí: ni segundo opener ni segunda nota "Origen: comentario…".
  it("no duplica la nota de origen cuando el log ya se estampó en el envío", async () => {
    logFindFirst.mockResolvedValue(null); // findFirst filtra por contactId: null
    expect(await linkCommentOrigin("c-new", "INSTAGRAM", "IGSID-1")).toBeNull();
    expect(activityCreate).not.toHaveBeenCalled();
    expect(logUpdateMany).not.toHaveBeenCalled();
  });

  it("un fallo al rellenar el opener no impide estampar el contactId", async () => {
    logFindFirst.mockResolvedValue(OLD_LOG);
    ensureConversation.mockRejectedValue(new Error("boom"));
    await expect(linkCommentOrigin("c-1", "INSTAGRAM", "IGSID-1")).resolves.not.toThrow();
    expect(logUpdateMany).toHaveBeenCalled();
  });
});

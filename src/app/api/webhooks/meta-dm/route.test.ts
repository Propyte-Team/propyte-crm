import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

const handleInboundMessage = vi.fn();
const resolveByIg = vi.fn();
const resolveByPage = vi.fn();
const markSignatureRejected = vi.fn();
const botRespond = vi.fn();
const handleComment = vi.fn();
vi.mock("@/lib/messaging/core", () => ({ handleInboundMessage: (...a: unknown[]) => handleInboundMessage(...a) }));
vi.mock("@/lib/messaging/social-accounts", () => ({
  resolveConnectorByIgBusinessId: (...a: unknown[]) => resolveByIg(...a),
  resolveConnectorByPageId: (...a: unknown[]) => resolveByPage(...a),
  markSocialConnectorsSignatureRejected: (...a: unknown[]) => markSignatureRejected(...a),
}));
vi.mock("@/lib/bot/bot-respond", () => ({ botRespond: (...a: unknown[]) => botRespond(...a) }));
// 2026-10-12: la cuenta sin conexión activa deja una nota (su escritura se prueba en send-failure.test.ts).
const recordBotSilence = vi.fn();
vi.mock("@/lib/messaging/send-failure", () => ({
  recordBotSilence: (...a: unknown[]) => recordBotSilence(...a),
}));
vi.mock("@/lib/comments/handle-comment", () => ({
  handleComment: (...a: unknown[]) => handleComment(...a),
}));

// Acuse rápido (2026-10-12): el bot y los comentarios ya no corren antes del 200, se
// agendan con runAfterResponse (`after()` de Next). Con el `after` real el callback corre
// al cerrarse la respuesta y la prueba no podría esperarlo; este doble lo guarda para que
// cada prueba decida cuándo correrlo y pueda comprobar que la respuesta NO lo esperó.
const agendados: Array<() => unknown> = [];
const runAfterResponse = vi.fn((fn: () => unknown) => {
  agendados.push(fn);
});
vi.mock("@/lib/runtime/after-response", () => ({
  runAfterResponse: (fn: () => unknown) => runAfterResponse(fn),
}));

/** Corre lo que el POST dejó para después del 200, como lo haría `after()`. */
async function enSegundoPlano() {
  while (agendados.length > 0) await agendados.shift()!();
}

// messaging_policy_enforcement (2026-10-12): el manejador real corre contra esta base simulada.
const connectorFindMany = vi.fn();
const userFindMany = vi.fn();
const notificationCreateMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: { findMany: (...a: unknown[]) => connectorFindMany(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    notification: { createMany: (...a: unknown[]) => notificationCreateMany(...a) },
  },
}));
const markConnectorLead = vi.fn();
vi.mock("@/lib/intake/connectors", () => ({
  markConnectorLead: (...a: unknown[]) => markConnectorLead(...a),
}));

import { GET, POST } from "./route";

beforeEach(() => {
  handleInboundMessage.mockReset();
  resolveByIg.mockReset();
  resolveByPage.mockReset();
  markSignatureRejected.mockReset();
  markSignatureRejected.mockResolvedValue(undefined);
  botRespond.mockReset();
  recordBotSilence.mockReset();
  recordBotSilence.mockResolvedValue(undefined);
  handleComment.mockReset();
  handleComment.mockResolvedValue({ status: "procesado", logId: "log-1" });
  agendados.length = 0;
  runAfterResponse.mockClear();
  connectorFindMany.mockReset();
  connectorFindMany.mockResolvedValue([]);
  userFindMany.mockReset();
  userFindMany.mockResolvedValue([]);
  notificationCreateMany.mockReset();
  notificationCreateMany.mockResolvedValue({ count: 0 });
  markConnectorLead.mockReset();
  markConnectorLead.mockResolvedValue(undefined);
  process.env.META_DM_VERIFY_TOKEN = "verifyme";
  process.env.META_DM_APP_SECRET = APP_SECRET;
});

function req(url: string, init?: RequestInit) { return new Request(url, init) as unknown as import("next/server").NextRequest; }

const APP_SECRET = "test-app-secret";
const URL_WEBHOOK = "https://x/api/webhooks/meta-dm";

/** La firma HMAC-SHA256 que Meta manda en x-hub-signature-256. */
function firma(body: string) {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex");
}

/** POST firmado correctamente, como lo manda Meta. */
function postFirmado(body: string) {
  return req(URL_WEBHOOK, { method: "POST", body, headers: { "x-hub-signature-256": firma(body) } });
}

describe("meta-dm webhook", () => {
  it("GET responde el challenge con verify token correcto", async () => {
    const res = await GET(req("https://x/api/webhooks/meta-dm?hub.mode=subscribe&hub.verify_token=verifyme&hub.challenge=42"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("42");
  });

  it("GET rechaza verify token incorrecto", async () => {
    const res = await GET(req("https://x/api/webhooks/meta-dm?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=42"));
    expect(res.status).toBe(403);
  });

  it("POST de IG enruta cada mensaje al core", async () => {
    handleInboundMessage.mockResolvedValue({ id: "m1" });
    const body = JSON.stringify({ object: "instagram", entry: [{ messaging: [{ sender: { id: "IGSID-1" }, message: { mid: "mid-1", text: "hola" } }] }] });
    const res = await POST(postFirmado(body));
    expect(res.status).toBe(200);
    expect(handleInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "INSTAGRAM", senderId: "IGSID-1", externalMessageId: "mid-1" }),
      { triggerBot: false }
    );
  });

  it("resuelve el conector IG por igBusinessId y setea connectorId en el mensaje", async () => {
    resolveByIg.mockResolvedValue({ id: "conn_ig" });
    const body = JSON.stringify({ object: "instagram", entry: [{ id: "17841", messaging: [
      { sender: { id: "IGSID" }, message: { mid: "m1", text: "hi" } },
    ] }] });
    await POST(postFirmado(body));
    expect(resolveByIg).toHaveBeenCalledWith("17841");
    expect(handleInboundMessage.mock.calls[0][0].connectorId).toBe("conn_ig");
  });

  it("procesa igual (connectorId null) si no hay conector para la cuenta", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveByIg.mockResolvedValue(null);
    const body = JSON.stringify({ object: "instagram", entry: [{ id: "999", messaging: [
      { sender: { id: "IGSID" }, message: { mid: "m2", text: "hi" } },
    ] }] });
    await POST(postFirmado(body));
    expect(handleInboundMessage).toHaveBeenCalledTimes(1);
    expect(handleInboundMessage.mock.calls[0][0].connectorId ?? null).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[meta-dm] sin conector activo"));
    warn.mockRestore();
  });

  it("echo de page (message_echoes) fluye al core con isEcho, echoAppId y connectorId", async () => {
    resolveByPage.mockResolvedValue({ id: "conn_ms" });
    const body = JSON.stringify({ object: "page", entry: [{ id: "103981", messaging: [{
      sender: { id: "103981" },
      recipient: { id: "PSID-user" },
      message: { mid: "mid-echo-r1", text: "respuesta desde Business Suite", is_echo: true, app_id: 263902037430900 },
    }] }] });
    const res = await POST(postFirmado(body));
    expect(res.status).toBe(200);
    expect(handleInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "MESSENGER",
        senderId: "PSID-user",
        isEcho: true,
        echoAppId: "263902037430900",
        connectorId: "conn_ms",
      }),
      { triggerBot: false }
    );
  });

  // BUG 2026-07-24: cada mensaje del batch disparaba una respuesta completa del bot.
  it("batch de 2 mensajes del mismo usuario → bot UNA sola vez con canal y conector", async () => {
    resolveByPage.mockResolvedValue({ id: "conn_ms" });
    handleInboundMessage.mockResolvedValue({ id: "m1", contactId: "c9" });
    const body = JSON.stringify({ object: "page", entry: [{ id: "103981", messaging: [
      { sender: { id: "PSID-1" }, message: { mid: "mm1", text: "hola" } },
      { sender: { id: "PSID-1" }, message: { mid: "mm2", attachments: [{ type: "file", payload: { url: "https://f/x.pdf" } }] } },
    ] }] });
    const res = await POST(postFirmado(body));
    expect(res.status).toBe(200);
    expect(handleInboundMessage).toHaveBeenCalledTimes(2);
    // El coalescing sigue igual, solo que la respuesta ya salió: se agenda UNA tarea.
    expect(runAfterResponse).toHaveBeenCalledTimes(1);
    await enSegundoPlano();
    expect(botRespond).toHaveBeenCalledTimes(1);
    expect(botRespond).toHaveBeenCalledWith("c9", { channel: "MESSENGER", connectorId: "conn_ms" });
  });

  // Marcas del agente (2026-10-09, seguimiento T4): un DM a una cuenta (accountId) sin conector
  // activo se ingiere igual —no se pierde el mensaje—, pero NO dispara al bot. Antes entraba a
  // `botTargets` con connectorId null y botRespond lo trataba como la marca predeterminada, así que
  // con la cuenta de una marca en pausa contestaba Propyte. WhatsApp ya tenía ese candado
  // (`unknownNumber`); este es el mismo para Instagram y Messenger.
  it("página sin conector activo → el mensaje se ingiere pero el bot NO responde", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveByPage.mockResolvedValue(null);
    handleInboundMessage.mockResolvedValue({ id: "m1", contactId: "c9" });
    const body = JSON.stringify({ object: "page", entry: [{ id: "PAGE-X", messaging: [
      { sender: { id: "PSID-1" }, recipient: { id: "PAGE-X" }, message: { mid: "mm-x", text: "hola" } },
    ] }] });
    const res = await POST(postFirmado(body));
    expect(res.status).toBe(200);
    expect(handleInboundMessage).toHaveBeenCalledTimes(1);
    // Ni siquiera se agenda: no hay a quién contestar.
    expect(runAfterResponse).not.toHaveBeenCalled();
    await enSegundoPlano();
    expect(botRespond).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[meta-dm] sin conector activo"));
    warn.mockRestore();
  });

  it("Instagram: igBusinessId sin conector activo → ingiere pero el bot NO responde", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveByIg.mockResolvedValue(null);
    handleInboundMessage.mockResolvedValue({ id: "m1", contactId: "c9" });
    const body = JSON.stringify({ object: "instagram", entry: [{ id: "17841-SIN-CUENTA", messaging: [
      { sender: { id: "IGSID-1" }, message: { mid: "mi-x", text: "hola" } },
    ] }] });
    const res = await POST(postFirmado(body));
    expect(res.status).toBe(200);
    expect(handleInboundMessage).toHaveBeenCalledTimes(1);
    // Ni siquiera se agenda: no hay a quién contestar.
    expect(runAfterResponse).not.toHaveBeenCalled();
    await enSegundoPlano();
    expect(botRespond).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[meta-dm] sin conector activo"));
    warn.mockRestore();
  });

  // #748 (2026-10-14): el mismo candado vale para el reparto. Una cuenta que no está dada de
  // alta podría ser la de otra marca: el contacto no se reparte entre los asesores de Propyte.
  it("cuenta sin conector activo: la ingesta se pide SIN reparto (route:false)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveByPage.mockResolvedValue(null);
    handleInboundMessage.mockResolvedValue({ id: "m1", contactId: "c9" });
    const body = JSON.stringify({ object: "page", entry: [{ id: "PAGE-X", messaging: [
      { sender: { id: "PSID-1" }, recipient: { id: "PAGE-X" }, message: { mid: "mm-r", text: "hola" } },
    ] }] });
    await POST(postFirmado(body));
    expect(handleInboundMessage.mock.calls[0][1]).toEqual({ triggerBot: false, route: false });
    warn.mockRestore();
  });

  it("cuenta que SÍ resuelve: la ingesta se pide como siempre (sí reparte)", async () => {
    resolveByPage.mockResolvedValue({ id: "conn_ms" });
    handleInboundMessage.mockResolvedValue({ id: "m1", contactId: "c9" });
    const body = JSON.stringify({ object: "page", entry: [{ id: "103981", messaging: [
      { sender: { id: "PSID-1" }, message: { mid: "mm-s", text: "hola" } },
    ] }] });
    await POST(postFirmado(body));
    expect(handleInboundMessage.mock.calls[0][1]).toEqual({ triggerBot: false });
  });

  // 2026-10-12, gemelo del número desconocido de WhatsApp: ese silencio solo dejaba el
  // console.warn. Ahora deja una nota en la conversación del mensaje.
  it.each([
    ["page", "MESSENGER", "Messenger", "PAGE-X"],
    ["instagram", "INSTAGRAM", "Instagram", "17841-SIN-CUENTA"],
  ] as const)("%s sin conector activo → nota en la conversación con la cuenta", async (object, channel, nombre, accountId) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveByPage.mockResolvedValue(null);
    resolveByIg.mockResolvedValue(null);
    handleInboundMessage.mockResolvedValue({ id: "m1", contactId: "c9", conversationId: "conv-9" });
    const body = JSON.stringify({ object, entry: [{ id: accountId, messaging: [
      { sender: { id: "USER-1" }, recipient: { id: accountId }, message: { mid: "m-nota", text: "hola" } },
    ] }] });

    const res = await POST(postFirmado(body));

    expect(res.status).toBe(200);
    expect(recordBotSilence).toHaveBeenCalledTimes(1);
    expect(recordBotSilence).toHaveBeenCalledWith({
      contactId: "c9",
      conversationId: "conv-9",
      channel,
      reason: `este mensaje de ${nombre} llegó a la cuenta ${accountId}, que no tiene una conexión activa en Conexiones.`,
    });
    await enSegundoPlano();
    expect(botRespond).not.toHaveBeenCalled();
  });

  it("cuenta que SÍ resuelve → sin nota", async () => {
    resolveByIg.mockResolvedValue({ id: "conn_ig" });
    handleInboundMessage.mockResolvedValue({ id: "m1", contactId: "c9", conversationId: "conv-9" });
    const body = JSON.stringify({ object: "instagram", entry: [{ id: "17841", messaging: [
      { sender: { id: "IGSID-1" }, message: { mid: "mi-ok-2", text: "hola" } },
    ] }] });
    await POST(postFirmado(body));
    await enSegundoPlano();
    expect(recordBotSilence).not.toHaveBeenCalled();
    expect(botRespond).toHaveBeenCalledTimes(1);
  });

  it("echo de una página sin conector → sin nota (el bot nunca contesta ecos)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveByPage.mockResolvedValue(null);
    handleInboundMessage.mockResolvedValue({ id: "m-echo", contactId: "c9", conversationId: "conv-9" });
    const body = JSON.stringify({ object: "page", entry: [{ id: "PAGE-X", messaging: [{
      sender: { id: "PAGE-X" },
      recipient: { id: "PSID-user" },
      message: { mid: "mid-echo-nota", text: "respuesta externa", is_echo: true },
    }] }] });
    await POST(postFirmado(body));
    expect(recordBotSilence).not.toHaveBeenCalled();
  });

  it("cuenta que SÍ resuelve → el bot responde con ese connectorId", async () => {
    resolveByIg.mockResolvedValue({ id: "conn_ig" });
    handleInboundMessage.mockImplementation(async (msg: { connectorId?: string | null }) => ({
      id: "m1",
      contactId: "c9",
      connectorId: msg.connectorId,
    }));
    const body = JSON.stringify({ object: "instagram", entry: [{ id: "17841", messaging: [
      { sender: { id: "IGSID-1" }, message: { mid: "mi-ok", text: "hola" } },
    ] }] });
    const res = await POST(postFirmado(body));
    expect(res.status).toBe(200);
    await enSegundoPlano();
    expect(botRespond).toHaveBeenCalledTimes(1);
    expect(botRespond).toHaveBeenCalledWith("c9", { channel: "INSTAGRAM", connectorId: "conn_ig" });
  });

  // Sin accountId (entry.id ausente) no hay a qué cuenta atribuirlo: se comporta como siempre,
  // con connectorId null EXPLÍCITO (no undefined) para que botRespond no infiera la cuenta del
  // hilo más reciente del contacto, que podría ser de otra marca.
  it("sin accountId → igual que antes: bot con connectorId null EXPLÍCITO (no undefined)", async () => {
    handleInboundMessage.mockResolvedValue({ id: "m1", contactId: "c9" });
    const body = JSON.stringify({ object: "page", entry: [{ messaging: [
      { sender: { id: "PSID-1" }, message: { mid: "mm-sin-id", text: "hola" } },
    ] }] });
    const res = await POST(postFirmado(body));
    expect(res.status).toBe(200);
    expect(resolveByPage).not.toHaveBeenCalled();
    await enSegundoPlano();
    expect(botRespond).toHaveBeenCalledTimes(1);
    expect(botRespond.mock.calls[0][1]).toEqual({ channel: "MESSENGER", connectorId: null });
    expect(botRespond.mock.calls[0][1].connectorId).toBeNull();
  });

  it("echo NO dispara al bot", async () => {
    resolveByPage.mockResolvedValue({ id: "conn_ms" });
    handleInboundMessage.mockResolvedValue({ id: "m-echo", contactId: "c9" });
    const body = JSON.stringify({ object: "page", entry: [{ id: "103981", messaging: [{
      sender: { id: "103981" },
      recipient: { id: "PSID-user" },
      message: { mid: "mid-echo-2", text: "respuesta externa", is_echo: true },
    }] }] });
    await POST(postFirmado(body));
    expect(runAfterResponse).not.toHaveBeenCalled();
    await enSegundoPlano();
    expect(botRespond).not.toHaveBeenCalled();
  });
});

describe("meta-dm webhook — comentarios", () => {
  it("payload de comentarios de IG llega al motor de comentarios", async () => {
    const body = JSON.stringify({
      object: "instagram",
      entry: [{ id: "17841", changes: [{ field: "comments", value: {
        id: "IGCOMMENT-1", text: "info", from: { id: "IGSID-1", username: "luisf" },
        media: { id: "MEDIA-1" },
      } }] }],
    });
    const res = await POST(postFirmado(body));
    expect(res.status).toBe(200);
    expect(handleComment).not.toHaveBeenCalled();
    await enSegundoPlano();
    expect(handleComment).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "INSTAGRAM", externalCommentId: "IGCOMMENT-1", accountId: "17841",
      })
    );
    expect(handleInboundMessage).not.toHaveBeenCalled();
  });

  it("payload de comentarios de Facebook llega al motor", async () => {
    const body = JSON.stringify({
      object: "page",
      entry: [{ id: "PAGE-1", changes: [{ field: "feed", value: {
        item: "comment", verb: "add", comment_id: "C-1", post_id: "P-1", parent_id: "P-1",
        from: { id: "ASID-1", name: "Luis" }, message: "info",
      } }] }],
    });
    await POST(postFirmado(body));
    await enSegundoPlano();
    expect(handleComment).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "FACEBOOK", externalCommentId: "C-1" })
    );
  });

  it("REGRESIÓN: un DM sigue yendo al intake y NO al motor de comentarios", async () => {
    handleInboundMessage.mockResolvedValue({ id: "m1", contactId: "c1" });
    const body = JSON.stringify({
      object: "instagram",
      entry: [{ messaging: [{ sender: { id: "IGSID-1" }, message: { mid: "mid-1", text: "hola" } }] }],
    });
    await POST(postFirmado(body));
    await enSegundoPlano();
    expect(handleInboundMessage).toHaveBeenCalled();
    expect(handleComment).not.toHaveBeenCalled();
  });

  it("un comentario que revienta no tumba el resto del batch", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    handleComment.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ status: "procesado" });
    const body = JSON.stringify({
      object: "instagram",
      entry: [{ id: "17841", changes: [
        { field: "comments", value: { id: "C-1", text: "info", from: { id: "A" }, media: { id: "M" } } },
        { field: "comments", value: { id: "C-2", text: "info", from: { id: "B" }, media: { id: "M" } } },
      ] }],
    });
    const res = await POST(postFirmado(body));
    expect(res.status).toBe(200);
    await enSegundoPlano();
    expect(handleComment).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith("[meta-dm] comentario:", expect.any(Error));
    error.mockRestore();
  });
});

// Acuse rápido (2026-10-12): Meta exige el 200 en menos de 20 s. Antes de responder solo va
// la ingesta del DM; el bot (Claude + Graph) y los comentarios (hasta ~22 s cada uno) se
// agendan para después del 200.
describe("meta-dm webhook — acuse rápido (bot y comentarios después del 200)", () => {
  /** Un DM y un comentario en la misma entrega de la Página. */
  const DM_Y_COMENTARIO = JSON.stringify({
    object: "page",
    entry: [{
      id: "PAGE-1",
      messaging: [{ sender: { id: "PSID-1" }, message: { mid: "mm-1", text: "hola" } }],
      changes: [{ field: "feed", value: {
        item: "comment", verb: "add", comment_id: "C-1", post_id: "P-1", parent_id: "P-1",
        from: { id: "ASID-1", name: "Luis" }, message: "info",
      } }],
    }],
  });

  beforeEach(() => {
    resolveByPage.mockResolvedValue({ id: "conn_ms" });
    handleInboundMessage.mockResolvedValue({ id: "m1", contactId: "c1" });
  });

  it("responde 200 con el DM ya ingerido y SIN haber llamado al bot ni al motor de comentarios", async () => {
    const res = await POST(postFirmado(DM_Y_COMENTARIO));

    expect(res.status).toBe(200);
    // `comments` es lo encolado: al responder todavía no corre ninguno.
    expect(await res.json()).toEqual({ ok: true, processed: 1, comments: 1, discarded: 0 });
    // La ingesta SÍ va antes del 200: el mensaje queda persistido aunque lo de después falle.
    expect(handleInboundMessage).toHaveBeenCalledTimes(1);
    expect(botRespond).not.toHaveBeenCalled();
    expect(handleComment).not.toHaveBeenCalled();
    expect(runAfterResponse).toHaveBeenCalledTimes(1);

    await enSegundoPlano();

    expect(botRespond).toHaveBeenCalledWith("c1", { channel: "MESSENGER", connectorId: "conn_ms" });
    expect(handleComment).toHaveBeenCalledWith(expect.objectContaining({ externalCommentId: "C-1" }));
  });

  it("un bot que revienta no detiene al siguiente contacto ni a los comentarios", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    handleInboundMessage
      .mockResolvedValueOnce({ id: "m1", contactId: "c1" })
      .mockResolvedValueOnce({ id: "m2", contactId: "c2" });
    botRespond.mockRejectedValueOnce(new Error("Claude caído")).mockResolvedValue(undefined);
    const body = JSON.stringify({
      object: "page",
      entry: [{
        id: "PAGE-1",
        messaging: [
          { sender: { id: "PSID-1" }, message: { mid: "mm-1", text: "hola" } },
          { sender: { id: "PSID-2" }, message: { mid: "mm-2", text: "buenas" } },
        ],
        changes: [{ field: "feed", value: {
          item: "comment", verb: "add", comment_id: "C-1", post_id: "P-1", parent_id: "P-1",
          from: { id: "ASID-1", name: "Luis" }, message: "info",
        } }],
      }],
    });

    const res = await POST(postFirmado(body));
    expect(res.status).toBe(200);

    // La tarea agendada nunca lanza: cada pieza atrapa su propio error.
    await expect(enSegundoPlano()).resolves.toBeUndefined();
    expect(botRespond).toHaveBeenCalledTimes(2);
    expect(botRespond.mock.calls.map((c) => c[0])).toEqual(["c1", "c2"]);
    expect(handleComment).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("[meta-dm] botRespond:", expect.any(Error));
    error.mockRestore();
  });

  it("un payload sin nada que hacer después (solo un echo) no agenda nada", async () => {
    const body = JSON.stringify({ object: "page", entry: [{ id: "PAGE-1", messaging: [{
      sender: { id: "PAGE-1" },
      recipient: { id: "PSID-1" },
      message: { mid: "mid-echo-3", text: "desde Business Suite", is_echo: true },
    }] }] });

    const res = await POST(postFirmado(body));

    expect(res.status).toBe(200);
    expect(handleInboundMessage).toHaveBeenCalledTimes(1);
    expect(runAfterResponse).not.toHaveBeenCalled();
  });
});

// messaging_policy_enforcement (2026-10-12): Meta avisa por aquí cuando bloquea o advierte
// a una Página. Se marca la cuenta (errorCount/lastError, lo que ya lee el monitoreo) y se
// avisa a los admins, después del 200 y sin tocar el inbox.
describe("meta-dm webhook — avisos de políticas de Meta", () => {
  const AVISO = JSON.stringify({
    object: "page",
    entry: [{ id: "PAGE-1", time: 1458692752478, messaging: [{
      recipient: { id: "PAGE-1" },
      timestamp: 1458692752478,
      policy_enforcement: { action: "block", reason: "Mensajes masivos no solicitados" },
    }] }],
  });

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    connectorFindMany.mockResolvedValue([
      { id: "conn-ms", name: "Messenger | DM Nativa Tulum", provider: "MESSENGER", config: { pageId: "PAGE-1" } },
      { id: "conn-ig", name: "IG - Nativa Tulum", provider: "INSTAGRAM", config: { pageId: "PAGE-1" } },
      { id: "conn-otra", name: "Messenger | DM Yaxnah", provider: "MESSENGER", config: { pageId: "PAGE-2" } },
    ]);
    userFindMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no entra al inbox ni al bot; responde 200 y lo deja para después", async () => {
    const res = await POST(postFirmado(AVISO));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 0, comments: 0, discarded: 0 });
    expect(handleInboundMessage).not.toHaveBeenCalled();
    expect(runAfterResponse).toHaveBeenCalledTimes(1);
    // Nada se escribe antes del 200.
    expect(markConnectorLead).not.toHaveBeenCalled();
    expect(notificationCreateMany).not.toHaveBeenCalled();

    await enSegundoPlano();

    expect(botRespond).not.toHaveBeenCalled();
    expect(handleComment).not.toHaveBeenCalled();
  });

  it("marca errorCount/lastError en las cuentas de esa Página y avisa a cada ADMIN activo", async () => {
    await POST(postFirmado(AVISO));
    await enSegundoPlano();

    const lastError = "Meta policy_enforcement: block — Mensajes masivos no solicitados";
    expect(markConnectorLead).toHaveBeenCalledTimes(2);
    expect(markConnectorLead).toHaveBeenCalledWith("conn-ms", lastError);
    expect(markConnectorLead).toHaveBeenCalledWith("conn-ig", lastError);

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "ADMIN", isActive: true, deletedAt: null } })
    );
    expect(notificationCreateMany).toHaveBeenCalledTimes(1);
    const { data } = notificationCreateMany.mock.calls[0][0] as { data: Array<Record<string, string>> };
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      userId: "admin-1",
      title: "Meta: aviso de políticas en Messenger | DM Nativa Tulum",
      link: "/conexiones",
    });
    expect(data[1].userId).toBe("admin-2");
  });

  it("un comentario que revienta no impide registrar el aviso del mismo webhook", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    handleComment.mockRejectedValue(new Error("Graph caído"));
    const body = JSON.stringify({
      object: "page",
      entry: [{
        id: "PAGE-1",
        messaging: [{ recipient: { id: "PAGE-1" }, policy_enforcement: { action: "warning", reason: "x" } }],
        changes: [{ field: "feed", value: {
          item: "comment", verb: "add", comment_id: "C-1", post_id: "P-1", parent_id: "P-1",
          from: { id: "ASID-1", name: "Luis" }, message: "info",
        } }],
      }],
    });

    await POST(postFirmado(body));
    await expect(enSegundoPlano()).resolves.toBeUndefined();

    expect(handleComment).toHaveBeenCalledTimes(1);
    expect(markConnectorLead).toHaveBeenCalledWith("conn-ms", "Meta policy_enforcement: warning — x");
    expect(notificationCreateMany).toHaveBeenCalledTimes(1);
  });

  it("si la base se cae al registrar el aviso, el 200 ya salió y la tarea no lanza", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    connectorFindMany.mockRejectedValue(new Error("db caída"));

    const res = await POST(postFirmado(AVISO));
    expect(res.status).toBe(200);
    await expect(enSegundoPlano()).resolves.toBeUndefined();
    expect(notificationCreateMany).not.toHaveBeenCalled();
  });

  it("con firma inválida no se registra ningún aviso", async () => {
    const res = await POST(req(URL_WEBHOOK, { method: "POST", body: AVISO, headers: { "x-hub-signature-256": firma("otro") } }));
    expect(res.status).toBe(401);
    expect(runAfterResponse).not.toHaveBeenCalled();
    expect(connectorFindMany).not.toHaveBeenCalled();
  });
});

describe("meta-dm webhook — autenticación de la firma", () => {
  const body = JSON.stringify({
    object: "page",
    entry: [{ id: "PAGE-1", messaging: [{ sender: { id: "PSID-1" }, message: { mid: "m1", text: "hola" } }] }],
  });

  // #767: antes de este arreglo, cada uno de estos 401 no dejaba rastro en ninguna
  // tabla — se veían idénticos a un día sin prospectos. Ahora marcan errorCount/lastError
  // en los conectores activos de IG/Messenger (best-effort, vía markSocialConnectorsSignatureRejected).
  it("rechaza con 401 si META_DM_APP_SECRET no está configurado (falla CERRADO) y marca el rechazo", async () => {
    delete process.env.META_DM_APP_SECRET;
    const res = await POST(req(URL_WEBHOOK, { method: "POST", body, headers: { "x-hub-signature-256": firma(body) } }));
    expect(res.status).toBe(401);
    expect(handleInboundMessage).not.toHaveBeenCalled();
    expect(runAfterResponse).not.toHaveBeenCalled();
    expect(botRespond).not.toHaveBeenCalled();
    expect(markSignatureRejected).toHaveBeenCalledTimes(1);
  });

  it("rechaza con 401 una firma que no corresponde al cuerpo y marca el rechazo", async () => {
    const res = await POST(req(URL_WEBHOOK, { method: "POST", body, headers: { "x-hub-signature-256": firma("otro cuerpo") } }));
    expect(res.status).toBe(401);
    expect(handleInboundMessage).not.toHaveBeenCalled();
    expect(runAfterResponse).not.toHaveBeenCalled();
    expect(markSignatureRejected).toHaveBeenCalledTimes(1);
  });

  it("rechaza con 401 si falta el header de firma y marca el rechazo", async () => {
    const res = await POST(req(URL_WEBHOOK, { method: "POST", body }));
    expect(res.status).toBe(401);
    expect(handleInboundMessage).not.toHaveBeenCalled();
    expect(runAfterResponse).not.toHaveBeenCalled();
    expect(markSignatureRejected).toHaveBeenCalledTimes(1);
    expect(markSignatureRejected.mock.calls[0][0]).toContain("ausente");
  });

  it("rechaza con 401 un header cuyo prefijo no es sha256= y marca el rechazo", async () => {
    const res = await POST(req(URL_WEBHOOK, { method: "POST", body, headers: { "x-hub-signature-256": "sha1=deadbeef" } }));
    expect(res.status).toBe(401);
    expect(handleInboundMessage).not.toHaveBeenCalled();
    expect(runAfterResponse).not.toHaveBeenCalled();
    expect(markSignatureRejected).toHaveBeenCalledTimes(1);
    expect(markSignatureRejected.mock.calls[0][0]).toContain("presente");
  });

  it("acepta el cuerpo firmado correctamente, lo procesa y NO marca ningún rechazo", async () => {
    handleInboundMessage.mockResolvedValue({ id: "m1", contactId: "c1" });
    const res = await POST(postFirmado(body));
    expect(res.status).toBe(200);
    expect(handleInboundMessage).toHaveBeenCalled();
    expect(markSignatureRejected).not.toHaveBeenCalled();
  });

  it("responde 400 a un cuerpo firmado que no es JSON", async () => {
    const malo = "no soy json";
    const res = await POST(req(URL_WEBHOOK, { method: "POST", body: malo, headers: { "x-hub-signature-256": firma(malo) } }));
    expect(res.status).toBe(400);
    expect(handleInboundMessage).not.toHaveBeenCalled();
  });

  // JSON.parse("null") no lanza, así que sin el guard de forma esto pasaba el catch
  // y reventaba en `body.object` con un 500 no manejado (#755).
  it.each(["null", "42", '"texto"'])("responde 400 a un cuerpo JSON que no es objeto: %s", async (crudo) => {
    const res = await POST(req(URL_WEBHOOK, { method: "POST", body: crudo, headers: { "x-hub-signature-256": firma(crudo) } }));
    expect(res.status).toBe(400);
    expect(handleInboundMessage).not.toHaveBeenCalled();
  });
});

// Despacho por `change.field` del webhook de WhatsApp (2026-10-14, coexistencia). Lo que fija:
// cada campo nuevo va a su manejador; ecos y estado de la cuenta antes del 200, historial y
// libreta después; sin cuenta activa del número no se guarda nada; y el formato de siempre (sin
// `field`) sigue entrando por el camino de mensajes. Los manejadores se prueban en
// lib/whatsapp/coex/webhook.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

const handleInboundWhatsApp = vi.fn();
const resolveConnectorByPhoneNumberId = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    message: { updateMany: vi.fn(async () => ({ count: 0 })), findFirst: vi.fn(async () => null) },
    contact: { updateMany: vi.fn(async () => ({ count: 1 })) },
  },
}));
vi.mock("@/lib/twilio/whatsapp", () => ({ handleInboundWhatsApp: (...a: unknown[]) => handleInboundWhatsApp(...a) }));
vi.mock("@/lib/whatsapp/accounts", () => ({
  resolveConnectorByPhoneNumberId: (...a: unknown[]) => resolveConnectorByPhoneNumberId(...a),
  getWhatsAppCredentials: () => null,
}));
vi.mock("@/lib/whatsapp/media", () => ({ resolveWaMediaToStorage: vi.fn() }));
const botRespond = vi.fn();
vi.mock("@/lib/bot/bot-respond", () => ({ botRespond: (...a: unknown[]) => botRespond(...a) }));
vi.mock("@/lib/messaging/send-failure", () => ({ recordBotSilence: vi.fn() }));

const handleAccountUpdate = vi.fn();
const handleAdvisorInbound = vi.fn();
const handleHistory = vi.fn();
const handleSmbAppStateSync = vi.fn();
const handleSmbMessageEchoes = vi.fn();
vi.mock("@/lib/whatsapp/coex/webhook", () => ({
  handleAccountUpdate: (...a: unknown[]) => handleAccountUpdate(...a),
  handleAdvisorInbound: (...a: unknown[]) => handleAdvisorInbound(...a),
  handleHistory: (...a: unknown[]) => handleHistory(...a),
  handleSmbAppStateSync: (...a: unknown[]) => handleSmbAppStateSync(...a),
  handleSmbMessageEchoes: (...a: unknown[]) => handleSmbMessageEchoes(...a),
}));

// PR 2: ¿el número sin cuenta activa es de un asesor? (lookup en cualquier estado)
const findAdvisorLineByPhoneNumberId = vi.fn();
vi.mock("@/lib/whatsapp/coex/advisor-line", () => ({
  findAdvisorLineByPhoneNumberId: (...a: unknown[]) => findAdvisorLineByPhoneNumberId(...a),
  isAdvisorLine: async () => false,
}));

const agendados: Array<() => unknown> = [];
const runAfterResponse = vi.fn();
vi.mock("@/lib/runtime/after-response", () => ({ runAfterResponse: (fn: () => unknown) => runAfterResponse(fn) }));
async function enSegundoPlano() {
  while (agendados.length > 0) await agendados.shift()!();
}

import { POST } from "./route";

const APP_SECRET = "test-wa-app-secret";
const CONNECTOR = { id: "conn-yax", provider: "WHATSAPP", status: "ACTIVE", scope: "BRAND", config: { phoneNumberId: "pn-1" } };

function post(payload: unknown) {
  const body = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex");
  const r = new Request("https://x/api/webhooks/whatsapp/meta", { method: "POST", body, headers: { "x-hub-signature-256": sig } });
  return POST(r as unknown as import("next/server").NextRequest);
}

const change = (field: string | undefined, value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba-1", changes: [{ ...(field ? { field } : {}), value }] }],
});
const META = { display_phone_number: "529990000000", phone_number_id: "pn-1" };

beforeEach(() => {
  process.env.META_WA_APP_SECRET = APP_SECRET;
  handleInboundWhatsApp.mockReset();
  handleInboundWhatsApp.mockResolvedValue({ contactId: "c1" });
  resolveConnectorByPhoneNumberId.mockReset();
  resolveConnectorByPhoneNumberId.mockResolvedValue(CONNECTOR);
  for (const f of [handleAccountUpdate, handleHistory, handleSmbAppStateSync, handleSmbMessageEchoes]) {
    f.mockReset();
    f.mockResolvedValue(0);
  }
  botRespond.mockReset();
  handleAdvisorInbound.mockReset();
  handleAdvisorInbound.mockResolvedValue({ kind: "pending" });
  findAdvisorLineByPhoneNumberId.mockReset();
  findAdvisorLineByPhoneNumberId.mockResolvedValue(null);
  agendados.length = 0;
  runAfterResponse.mockReset();
  runAfterResponse.mockImplementation((fn: () => unknown) => {
    agendados.push(fn);
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("webhook de WhatsApp — campos de la coexistencia", () => {
  it("smb_message_echoes → se guarda ANTES del 200, con la cuenta del número", async () => {
    const value = { metadata: META, message_echoes: [{ id: "wamid.E1", to: "5219981234567", type: "text", text: { body: "hola" } }] };
    const res = await post(change("smb_message_echoes", value));
    expect(res.status).toBe(200);
    expect(handleSmbMessageEchoes).toHaveBeenCalledWith(value, CONNECTOR);
    expect(handleInboundWhatsApp).not.toHaveBeenCalled(); // un eco nunca es un entrante
    expect(runAfterResponse).not.toHaveBeenCalled();
  });

  it("history → se agenda para DESPUÉS del 200 (puede traer miles de mensajes)", async () => {
    const value = { metadata: META, history: [{ metadata: { phase: 0, chunk_order: 1, progress: 10 }, threads: [] }] };
    const res = await post(change("history", value));
    expect(res.status).toBe(200);
    expect(handleHistory).not.toHaveBeenCalled(); // la respuesta no lo esperó
    await enSegundoPlano();
    expect(handleHistory).toHaveBeenCalledWith(value, CONNECTOR);
  });

  it("🚨 el webhook aparte con la media del historial (field history + messages) NO entra como mensaje nuevo", async () => {
    const value = { metadata: META, messages: [{ id: "wamid.H3", from: "5219981234567", type: "image", image: { id: "m1" } }] };
    await post(change("history", value));
    await enSegundoPlano();
    expect(handleInboundWhatsApp).not.toHaveBeenCalled();
    expect(handleHistory).toHaveBeenCalledWith(value, CONNECTOR);
  });

  it("smb_app_state_sync → después del 200", async () => {
    const value = { metadata: META, state_sync: [] };
    await post(change("smb_app_state_sync", value));
    expect(handleSmbAppStateSync).not.toHaveBeenCalled();
    await enSegundoPlano();
    expect(handleSmbAppStateSync).toHaveBeenCalledWith(value, CONNECTOR);
  });

  it("account_update → antes del 200, con el WABA de entry.id", async () => {
    const value = { event: "PARTNER_REMOVED", disconnection_info: { reason: "CHANGE_NUMBER", initiated_by: "USER" } };
    await post(change("account_update", value));
    expect(handleAccountUpdate).toHaveBeenCalledWith("waba-1", value);
    expect(resolveConnectorByPhoneNumberId).not.toHaveBeenCalled();
  });

  it("🚨 ecos o historial de un número sin cuenta activa → se descartan sin guardar nada", async () => {
    resolveConnectorByPhoneNumberId.mockResolvedValue(null);
    await post(change("smb_message_echoes", { metadata: META, message_echoes: [{ id: "x", to: "1" }] }));
    await post(change("history", { metadata: META, history: [] }));
    await enSegundoPlano();
    expect(handleSmbMessageEchoes).not.toHaveBeenCalled();
    expect(handleHistory).not.toHaveBeenCalled();
  });

  it("un fallo del historial después del 200 no rompe nada (queda en el log)", async () => {
    handleHistory.mockRejectedValue(new Error("boom"));
    const res = await post(change("history", { metadata: META, history: [] }));
    expect(res.status).toBe(200);
    await expect(enSegundoPlano()).resolves.toBeUndefined();
  });

  it("mensajes sin `field` (formato de siempre) y con field messages siguen el camino normal", async () => {
    const value = {
      metadata: META,
      contacts: [{ profile: { name: "Ana" }, wa_id: "5219981234567" }],
      messages: [{ id: "wamid.1", from: "5219981234567", type: "text", text: { body: "hola" } }],
    };
    await post(change(undefined, value));
    await post(change("messages", { ...value, messages: [{ ...value.messages[0], id: "wamid.2" }] }));
    expect(handleInboundWhatsApp).toHaveBeenCalledTimes(2);
    expect(handleSmbMessageEchoes).not.toHaveBeenCalled();
  });

  it("campos que este webhook no usa se ignoran", async () => {
    const res = await post(change("message_template_status_update", { event: "APPROVED" }));
    expect(res.status).toBe(200);
    expect(handleInboundWhatsApp).not.toHaveBeenCalled();
    expect(handleAccountUpdate).not.toHaveBeenCalled();
  });
});

// PR 2: el número propio de un asesor pasa SIEMPRE por el filtro de privacidad y nunca por el bot.
describe("webhook de WhatsApp — número de asesor", () => {
  const ADVISOR = { ...CONNECTOR, id: "conn-ana", scope: "ADVISOR", ownerUserId: "u-ana" };
  const value = {
    metadata: META,
    contacts: [{ profile: { name: "Juan" }, wa_id: "5215550001111", user_id: "MX.2" }],
    messages: [{ id: "wamid.A1", from: "5215550001111", type: "text", text: { body: "hola" } }],
  };

  it("los mensajes van al filtro (con teléfono, BSUID y nombre) y nunca al camino normal ni al bot", async () => {
    resolveConnectorByPhoneNumberId.mockResolvedValue(ADVISOR);
    handleAdvisorInbound.mockResolvedValue({ kind: "stored", contactId: "c1" });
    const res = await post(change("messages", value));
    expect(res.status).toBe(200);
    expect(handleAdvisorInbound).toHaveBeenCalledWith({
      connector: ADVISOR,
      msg: value.messages[0],
      phone: "5215550001111",
      bsuid: "MX.2",
      profileName: "Juan",
    });
    expect(handleInboundWhatsApp).not.toHaveBeenCalled();
    expect(runAfterResponse).not.toHaveBeenCalled(); // ni un bot agendado
    await enSegundoPlano();
    expect(botRespond).not.toHaveBeenCalled();
  });

  it("🚨 número de asesor con la cuenta pausada o borrada → sus mensajes se descartan (no entran como «número sin registrar»)", async () => {
    resolveConnectorByPhoneNumberId.mockResolvedValue(null);
    findAdvisorLineByPhoneNumberId.mockResolvedValue({ id: "conn-ana" });
    await post(change("messages", value));
    expect(findAdvisorLineByPhoneNumberId).toHaveBeenCalledWith("pn-1");
    expect(handleInboundWhatsApp).not.toHaveBeenCalled();
    expect(handleAdvisorInbound).not.toHaveBeenCalled();
  });

  it("🚨 si no se puede saber si el número sin cuenta es de un asesor → también se descarta", async () => {
    resolveConnectorByPhoneNumberId.mockResolvedValue(null);
    findAdvisorLineByPhoneNumberId.mockRejectedValue(new Error("db caída"));
    await post(change("messages", value));
    expect(handleInboundWhatsApp).not.toHaveBeenCalled();
  });

  it("un número sin cuenta que NO es de asesor sigue el camino de siempre (se guarda sin reparto ni bot)", async () => {
    resolveConnectorByPhoneNumberId.mockResolvedValue(null);
    await post(change("messages", value));
    expect(handleInboundWhatsApp).toHaveBeenCalledWith(expect.anything(), { triggerBot: false, route: false });
  });
});

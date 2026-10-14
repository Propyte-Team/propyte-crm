// Campos de webhook de la coexistencia (2026-10-14). La regla que se fija aquí, campo por campo:
// nada de esto crea contactos, y lo que no es de un contacto que ya existe se descarta sin escribir
// nada (decisión 3 del dueño). Más el estado de la cuenta (account_update) y sus avisos.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LeadConnector } from "@prisma/client";

const msgFindFirst = vi.fn();
const msgFindMany = vi.fn();
const msgCreateMany = vi.fn();
const msgUpdate = vi.fn();
const convUpdateMany = vi.fn();
const connFindMany = vi.fn();
const connFindUnique = vi.fn();
const connUpdate = vi.fn();
const userFindMany = vi.fn();
const notifCreateMany = vi.fn();
const executeRaw = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    message: {
      findFirst: (...a: unknown[]) => msgFindFirst(...a),
      findMany: (...a: unknown[]) => msgFindMany(...a),
      createMany: (...a: unknown[]) => msgCreateMany(...a),
      update: (...a: unknown[]) => msgUpdate(...a),
    },
    conversation: { updateMany: (...a: unknown[]) => convUpdateMany(...a) },
    leadConnector: {
      findMany: (...a: unknown[]) => connFindMany(...a),
      findUnique: (...a: unknown[]) => connFindUnique(...a),
      update: (...a: unknown[]) => connUpdate(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    notification: { createMany: (...a: unknown[]) => notifCreateMany(...a) },
    $executeRaw: (...a: unknown[]) => executeRaw(...a),
  },
}));

const findWhatsAppContact = vi.fn();
const handleInboundMessage = vi.fn();
vi.mock("@/lib/messaging/core", () => ({
  findWhatsAppContact: (...a: unknown[]) => findWhatsAppContact(...a),
  handleInboundMessage: (...a: unknown[]) => handleInboundMessage(...a),
}));
const ensureConversation = vi.fn();
vi.mock("@/lib/messaging/conversations", () => ({ ensureConversation: (...a: unknown[]) => ensureConversation(...a) }));
const resolveWaMediaToStorage = vi.fn();
vi.mock("@/lib/whatsapp/media", () => ({ resolveWaMediaToStorage: (...a: unknown[]) => resolveWaMediaToStorage(...a) }));
vi.mock("@/lib/whatsapp/accounts", () => ({
  getWhatsAppCredentials: () => ({ phoneNumberId: "pn-1", accessToken: "tok-cuenta" }),
}));
const attachBrand = vi.fn();
vi.mock("@/lib/brands/attach", () => ({ attachBrand: (...a: unknown[]) => attachBrand(...a) }));
vi.mock("@/lib/brands/resolve", () => ({ getDefaultBrandId: async () => "brand-default" }));
const contactUpdateInTx = vi.fn();
const withChangeSource = vi.fn();
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (...a: unknown[]) => withChangeSource(...a),
}));

import {
  handleAccountUpdate,
  handleHistory,
  handleSmbAppStateSync,
  handleSmbMessageEchoes,
  counterpartOf,
  HISTORY_DECLINED_CODE,
  type HistoryValue,
} from "./webhook";

const CONNECTOR = {
  id: "conn-yax",
  name: "WhatsApp · Yaxnáh",
  provider: "WHATSAPP",
  status: "ACTIVE",
  scope: "BRAND",
  brandId: "brand-yax",
  config: { phoneNumberId: "pn-1", wabaId: "waba-1", displayPhone: "+52 999 000 0000", coex: { accountState: "CONNECTED" } },
} as unknown as LeadConnector;

const ANA = { id: "c-ana", firstName: "Ana", lastName: "López", assignedToId: "u-asesor" };
const META = { display_phone_number: "529990000000", phone_number_id: "pn-1" };

/** El contacto «vivo» de cada teléfono (por dígitos). Lo demás es desconocido. */
let known: Record<string, typeof ANA | { id: string; firstName: string; lastName: string; assignedToId: string | null }>;

beforeEach(() => {
  known = { "+529981234567": ANA };
  findWhatsAppContact.mockReset();
  findWhatsAppContact.mockImplementation(async (senderId: string) => known[senderId] ?? null);
  handleInboundMessage.mockReset();
  handleInboundMessage.mockResolvedValue({ id: "m-echo" });
  ensureConversation.mockReset();
  ensureConversation.mockResolvedValue({ id: "conv-1" });
  resolveWaMediaToStorage.mockReset();
  resolveWaMediaToStorage.mockResolvedValue({ path: "chat-media/x.jpg", mimeType: "image/jpeg" });
  msgFindFirst.mockReset();
  msgFindMany.mockReset();
  msgFindMany.mockResolvedValue([]);
  msgCreateMany.mockReset();
  msgCreateMany.mockImplementation(async (args: { data: unknown[] }) => ({ count: args.data.length }));
  msgUpdate.mockReset();
  convUpdateMany.mockReset();
  convUpdateMany.mockResolvedValue({ count: 1 });
  connFindMany.mockReset();
  connFindUnique.mockReset();
  connFindUnique.mockResolvedValue({ config: CONNECTOR.config });
  connUpdate.mockReset();
  connUpdate.mockResolvedValue({});
  userFindMany.mockReset();
  userFindMany.mockResolvedValue([{ id: "u-admin-1" }, { id: "u-admin-2" }]);
  notifCreateMany.mockReset();
  notifCreateMany.mockResolvedValue({ count: 2 });
  executeRaw.mockReset();
  executeRaw.mockResolvedValue(1);
  attachBrand.mockReset();
  contactUpdateInTx.mockReset();
  withChangeSource.mockReset();
  withChangeSource.mockImplementation(async (_opts: unknown, fn: (tx: unknown) => unknown) =>
    fn({ contact: { update: (...a: unknown[]) => contactUpdateInTx(...a) } }),
  );
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

const patches = () => executeRaw.mock.calls.map((c) => JSON.parse(String(c[1])));

describe("counterpartOf — teléfono vs BSUID", () => {
  it("dígitos (con o sin +) = teléfono normalizado", () => {
    expect(counterpartOf("5219981234567")).toEqual({ senderId: "+529981234567", isPhone: true, bsuid: null });
    expect(counterpartOf("+529981234567").isPhone).toBe(true);
  });
  it("🚨 un BSUID nunca se trata como teléfono (#827)", () => {
    expect(counterpartOf("MX.13491208655302741918")).toEqual({
      senderId: "MX.13491208655302741918",
      isPhone: false,
      bsuid: "MX.13491208655302741918",
    });
  });
});

describe("smb_message_echoes — lo que el negocio manda desde la app", () => {
  it("a un contacto conocido → se guarda como eco (saliente de asesor) en la cuenta del número", async () => {
    const n = await handleSmbMessageEchoes(
      {
        metadata: META,
        message_echoes: [{ id: "wamid.E1", from: "529990000000", to: "5219981234567", type: "text", text: { body: "Te mando la info" } }],
      },
      CONNECTOR,
    );
    expect(n).toBe(1);
    expect(handleInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "WHATSAPP",
        senderId: "+529981234567",
        senderIdIsPhone: true,
        externalMessageId: "wamid.E1",
        text: "Te mando la info",
        isEcho: true,
        connectorId: "conn-yax",
      }),
    );
  });

  it("🚨 a un desconocido → no se guarda nada y NO se descarga su media", async () => {
    const n = await handleSmbMessageEchoes(
      {
        metadata: META,
        message_echoes: [{ id: "wamid.E2", to: "5215550001111", type: "image", image: { id: "media-9", caption: "foto" } }],
      },
      CONNECTOR,
    );
    expect(n).toBe(0);
    expect(handleInboundMessage).not.toHaveBeenCalled();
    expect(resolveWaMediaToStorage).not.toHaveBeenCalled();
  });

  it("con media a un contacto conocido → la media se resuelve con el token de la cuenta y viaja en el eco", async () => {
    await handleSmbMessageEchoes(
      { metadata: META, message_echoes: [{ id: "wamid.E3", to: "5219981234567", type: "image", image: { id: "media-1", caption: "plano" } }] },
      CONNECTOR,
    );
    expect(resolveWaMediaToStorage).toHaveBeenCalledWith("media-1", "tok-cuenta");
    expect(handleInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "[Imagen] plano", mediaUrl: "chat-media/x.jpg", mediaType: "image", mediaMimeType: "image/jpeg" }),
    );
  });

  it("un eco que revienta no frena a los demás", async () => {
    handleInboundMessage.mockRejectedValueOnce(new Error("db caída"));
    const n = await handleSmbMessageEchoes(
      {
        metadata: META,
        message_echoes: [
          { id: "wamid.A", to: "5219981234567", type: "text", text: { body: "1" } },
          { id: "wamid.B", to: "5219981234567", type: "text", text: { body: "2" } },
        ],
      },
      CONNECTOR,
    );
    expect(n).toBe(1);
  });
});

describe("history — solo contactos que ya existen", () => {
  type Thread = NonNullable<NonNullable<HistoryValue["history"]>[number]["threads"]>[number];
  const chunk = (threads: Thread[], metadata = { phase: 0, chunk_order: 1, progress: 40 }): HistoryValue => ({
    metadata: META,
    history: [{ metadata, threads }],
  });

  it("hilo de un contacto conocido → se importa con fecha, dirección y estado originales, sin bot ni avisos", async () => {
    const r = await handleHistory(
      chunk([
        {
          id: "5219981234567",
          messages: [
            { id: "wamid.H1", from: "529990000000", to: "5219981234567", timestamp: "1739230955", type: "text", text: { body: "Hola Ana" }, history_context: { status: "READ" } },
            { id: "wamid.H2", from: "5219981234567", timestamp: "1739230970", type: "text", text: { body: "Gracias" }, history_context: { status: "READ" } },
            { id: "wamid.H3", from: "529990000000", timestamp: "1739230980", type: "media_placeholder", history_context: { status: "PLAYED" } },
          ],
        },
      ]),
      CONNECTOR,
    );
    expect(r).toMatchObject({ imported: 3, threadsImported: 1, threadsDiscarded: 0 });
    expect(ensureConversation).toHaveBeenCalledWith({ contactId: "c-ana", channel: "WHATSAPP", connectorId: "conn-yax" });
    const rows = msgCreateMany.mock.calls[0][0].data;
    expect(msgCreateMany.mock.calls[0][0].skipDuplicates).toBe(true);
    expect(rows[0]).toMatchObject({ direction: "OUTBOUND", sender: "ADVISOR", body: "Hola Ana", status: "READ", externalMessageId: "wamid.H1", conversationId: "conv-1" });
    expect(rows[0].createdAt).toEqual(new Date(1739230955 * 1000));
    expect(rows[1]).toMatchObject({ direction: "INBOUND", sender: "CONTACT", body: "Gracias" });
    expect(rows[2]).toMatchObject({ direction: "OUTBOUND", body: "[Archivo]" });
    // Las fechas del hilo solo avanzan.
    expect(convUpdateMany).toHaveBeenCalledWith({
      where: { id: "conv-1", OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: new Date(1739230980 * 1000) } }] },
      data: { lastMessageAt: new Date(1739230980 * 1000) },
    });
    // Contacto de la marca de la cuenta, igual que un inbound.
    expect(attachBrand).toHaveBeenCalledWith(expect.objectContaining({ contactId: "c-ana", brandId: "brand-yax" }));
    // Es pasado: nada del pipeline de inbound.
    expect(handleInboundMessage).not.toHaveBeenCalled();
  });

  it("🚨 hilo de un desconocido → se descarta entero: ni conversación, ni mensajes", async () => {
    const r = await handleHistory(
      chunk([{ id: "5215550001111", messages: [{ id: "wamid.X", from: "5215550001111", timestamp: "1739230955", type: "text", text: { body: "personal" } }] }]),
      CONNECTOR,
    );
    expect(r).toMatchObject({ imported: 0, threadsImported: 0, threadsDiscarded: 1 });
    expect(ensureConversation).not.toHaveBeenCalled();
    expect(msgCreateMany).not.toHaveBeenCalled();
  });

  it("mensajes que ya están (por el webhook normal o enviados por el CRM) no se duplican", async () => {
    msgFindMany.mockResolvedValue([{ externalMessageId: "wamid.H1", twilioSid: null }, { externalMessageId: null, twilioSid: "wamid.H2" }]);
    await handleHistory(
      chunk([
        {
          id: "5219981234567",
          messages: [
            { id: "wamid.H1", from: "5219981234567", timestamp: "1", type: "text", text: { body: "a" } },
            { id: "wamid.H2", from: "529990000000", timestamp: "2", type: "text", text: { body: "b" } },
            { id: "wamid.H3", from: "5219981234567", timestamp: "3", type: "text", text: { body: "c" } },
          ],
        },
      ]),
      CONNECTOR,
    );
    expect(msgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ externalMessageId: { in: ["wamid.H1", "wamid.H2", "wamid.H3"] } }, { twilioSid: { in: ["wamid.H1", "wamid.H2", "wamid.H3"] } }] } }),
    );
    expect(msgCreateMany.mock.calls[0][0].data.map((r: { externalMessageId: string }) => r.externalMessageId)).toEqual(["wamid.H3"]);
  });

  it("progreso: 100 → COMPLETE; un trozo atrasado no lo deshace", async () => {
    await handleHistory(chunk([], { phase: 2, chunk_order: 3, progress: 100 }), CONNECTOR);
    expect(patches()).toContainEqual({ historySync: { state: "COMPLETE", at: expect.any(String), progress: 100, phase: 2 } });

    executeRaw.mockClear();
    connFindUnique.mockResolvedValue({ config: { coex: { historySync: { state: "COMPLETE", progress: 100 } } } });
    await handleHistory(chunk([], { phase: 1, chunk_order: 1, progress: 60 }), CONNECTOR);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("el progreso nunca retrocede entre trozos desordenados", async () => {
    connFindUnique.mockResolvedValue({ config: { coex: { historySync: { state: "IN_PROGRESS", progress: 80 } } } });
    await handleHistory(chunk([], { phase: 1, chunk_order: 1, progress: 30 }), CONNECTOR);
    expect(patches()[0].historySync).toMatchObject({ state: "IN_PROGRESS", progress: 80 });
  });

  it(`el negocio no compartió el historial (${HISTORY_DECLINED_CODE}) → DECLINED`, async () => {
    await handleHistory(
      { metadata: META, history: [{ errors: [{ code: HISTORY_DECLINED_CODE, title: "History sync is turned off by the business" }] }] },
      CONNECTOR,
    );
    expect(patches()).toEqual([{ historySync: { state: "DECLINED", at: expect.any(String) } }]);
  });

  it("el webhook aparte con la media solo completa mensajes ya importados (de contactos conocidos)", async () => {
    msgFindFirst.mockImplementation(async (args: { where: { externalMessageId: string } }) =>
      args.where.externalMessageId === "wamid.H3" ? { id: "m-3", mediaUrl: null } : null,
    );
    const r = await handleHistory(
      {
        metadata: META,
        messages: [
          { id: "wamid.H3", from: "5219981234567", type: "image", image: { id: "media-3", caption: "fachada" } },
          { id: "wamid.DESCONOCIDO", from: "5215550001111", type: "image", image: { id: "media-x" } },
        ],
      },
      CONNECTOR,
    );
    expect(r.mediaUpdated).toBe(1);
    expect(msgFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { externalMessageId: "wamid.H3", conversation: { connectorId: "conn-yax" } } }),
    );
    expect(resolveWaMediaToStorage).toHaveBeenCalledTimes(1);
    expect(resolveWaMediaToStorage).toHaveBeenCalledWith("media-3", "tok-cuenta");
    expect(msgUpdate).toHaveBeenCalledWith({
      where: { id: "m-3" },
      data: expect.objectContaining({ mediaUrl: "chat-media/x.jpg", mediaType: "image", body: "[Imagen] fachada" }),
    });
  });
});

describe("smb_app_state_sync — la libreta nunca crea contactos", () => {
  it("le pone nombre a un contacto existente que sigue con el provisional", async () => {
    known["+529981234567"] = { id: "c-prov", firstName: "WhatsApp", lastName: "(por identificar)", assignedToId: null };
    const n = await handleSmbAppStateSync(
      { metadata: META, state_sync: [{ type: "contact", action: "add", contact: { full_name: "Pablo Morales Ruiz", phone_number: "5219981234567" } }] },
      CONNECTOR,
    );
    expect(n).toBe(1);
    expect(withChangeSource).toHaveBeenCalledWith({ source: "whatsapp_libreta" }, expect.any(Function));
    expect(contactUpdateInTx).toHaveBeenCalledWith({ where: { id: "c-prov" }, data: { firstName: "Pablo", lastName: "Morales Ruiz" } });
  });

  it("no toca un nombre que puso una persona", async () => {
    const n = await handleSmbAppStateSync(
      { metadata: META, state_sync: [{ type: "contact", action: "add", contact: { full_name: "Anita", phone_number: "5219981234567" } }] },
      CONNECTOR,
    );
    expect(n).toBe(0);
    expect(contactUpdateInTx).not.toHaveBeenCalled();
  });

  it("🚨 un contacto de la libreta que no está en el CRM no se crea ni se guarda", async () => {
    const n = await handleSmbAppStateSync(
      { metadata: META, state_sync: [{ type: "contact", action: "add", contact: { full_name: "Mamá", phone_number: "5215550001111" } }] },
      CONNECTOR,
    );
    expect(n).toBe(0);
    expect(withChangeSource).not.toHaveBeenCalled();
  });

  it("las bajas de la libreta (remove) se ignoran", async () => {
    await handleSmbAppStateSync(
      { metadata: META, state_sync: [{ type: "contact", action: "remove", contact: { phone_number: "5219981234567" } }] },
      CONNECTOR,
    );
    expect(findWhatsAppContact).not.toHaveBeenCalled();
  });
});

describe("account_update — estados de la cuenta", () => {
  const conn = (accountState: string, status = "ACTIVE") => ({
    id: "conn-yax",
    name: "WhatsApp · Yaxnáh",
    status,
    config: { wabaId: "waba-1", displayPhone: "+52 999 000 0000", coex: { accountState } },
  });

  it("PARTNER_REMOVED → ERROR con el motivo, estado DISCONNECTED y aviso a los ADMIN", async () => {
    connFindMany.mockResolvedValue([conn("CONNECTED")]);
    const n = await handleAccountUpdate("waba-1", {
      event: "PARTNER_REMOVED",
      disconnection_info: { reason: "PRIMARY_INACTIVITY", initiated_by: "SYSTEM" },
    });
    expect(n).toBe(1);
    expect(connFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: "WHATSAPP", deletedAt: null, config: { path: ["wabaId"], equals: "waba-1" } } }),
    );
    expect(connUpdate).toHaveBeenCalledWith({
      where: { id: "conn-yax" },
      data: { status: "ERROR", lastError: expect.stringContaining("teléfono principal estuvo inactivo") },
    });
    expect(patches()[0]).toMatchObject({
      accountState: "DISCONNECTED",
      disconnection: { reason: "PRIMARY_INACTIVITY", initiatedBy: "SYSTEM" },
    });
    expect(userFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ role: "ADMIN" }) }));
    const notices = notifCreateMany.mock.calls[0][0].data;
    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({ userId: "u-admin-1", type: "whatsapp_account", link: "/conexiones" });
    expect(notices[0].title).toContain("desconectado");
  });

  it("ACCOUNT_OFFBOARDED → ERROR temporal, estado OFFBOARDED", async () => {
    connFindMany.mockResolvedValue([conn("CONNECTED")]);
    await handleAccountUpdate("waba-1", { event: "ACCOUNT_OFFBOARDED" });
    expect(connUpdate.mock.calls[0][0].data).toMatchObject({ status: "ERROR", lastError: expect.stringContaining("temporalmente") });
    expect(patches()[0]).toMatchObject({ accountState: "OFFBOARDED", disconnection: null });
  });

  it("ACCOUNT_RECONNECTED → vuelve a ACTIVA si la habíamos puesto en ERROR por esto", async () => {
    connFindMany.mockResolvedValue([conn("OFFBOARDED", "ERROR")]);
    await handleAccountUpdate("waba-1", { event: "ACCOUNT_RECONNECTED" });
    expect(connUpdate).toHaveBeenCalledWith({ where: { id: "conn-yax" }, data: { status: "ACTIVE", lastError: null, errorCount: 0 } });
    expect(patches()[0]).toMatchObject({ accountState: "CONNECTED" });
    expect(notifCreateMany.mock.calls[0][0].data[0].title).toContain("reconectado");
  });

  it("ACCOUNT_RECONNECTED no reactiva una cuenta que alguien pausó a mano", async () => {
    connFindMany.mockResolvedValue([conn("OFFBOARDED", "PAUSED")]);
    await handleAccountUpdate("waba-1", { event: "ACCOUNT_RECONNECTED" });
    expect(connUpdate).not.toHaveBeenCalled();
    expect(patches()[0]).toMatchObject({ accountState: "CONNECTED" });
  });

  it("reentrega del mismo evento → no cambia nada ni repite el aviso", async () => {
    connFindMany.mockResolvedValue([conn("DISCONNECTED", "ERROR")]);
    const n = await handleAccountUpdate("waba-1", { event: "PARTNER_REMOVED" });
    expect(n).toBe(0);
    expect(connUpdate).not.toHaveBeenCalled();
    expect(notifCreateMany).not.toHaveBeenCalled();
  });

  it("varias cuentas en la WABA: con el número en el evento, solo la de ese número", async () => {
    connFindMany.mockResolvedValue([
      { ...conn("CONNECTED"), id: "conn-a", config: { wabaId: "waba-1", displayPhone: "+52 999 000 0000", coex: { accountState: "CONNECTED" } } },
      { ...conn("CONNECTED"), id: "conn-b", config: { wabaId: "waba-1", displayPhone: "+52 999 111 1111", coex: { accountState: "CONNECTED" } } },
    ]);
    await handleAccountUpdate("waba-1", { event: "PARTNER_REMOVED", phone_number: "529991111111" });
    expect(connUpdate).toHaveBeenCalledTimes(1);
    expect(connUpdate.mock.calls[0][0].where).toEqual({ id: "conn-b" });
  });

  it("otros eventos de account_update (o una cuenta manual sin coexistencia) se ignoran", async () => {
    expect(await handleAccountUpdate("waba-1", { event: "ACCOUNT_VIOLATION" })).toBe(0);
    expect(connFindMany).not.toHaveBeenCalled();
    connFindMany.mockResolvedValue([{ id: "conn-manual", name: "x", status: "ACTIVE", config: { wabaId: "waba-1" } }]);
    expect(await handleAccountUpdate("waba-1", { event: "PARTNER_REMOVED" })).toBe(0);
  });
});

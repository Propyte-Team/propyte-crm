import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks de dependencias externas de bot-respond.ts ---

const sendChannelMessage = vi.fn();
vi.mock("@/lib/messaging/dispatcher", () => ({
  sendChannelMessage: (...a: unknown[]) => sendChannelMessage(...a),
}));

const contactFindUnique = vi.fn();
const convFindFirst = vi.fn();
const convFindUnique = vi.fn();
const convCreate = vi.fn();
const convUpdate = vi.fn();
const msgFindMany = vi.fn();
const msgFindFirst = vi.fn();
const userFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    conversation: {
      findFirst: (...a: unknown[]) => convFindFirst(...a),
      findUnique: (...a: unknown[]) => convFindUnique(...a),
      create: (...a: unknown[]) => convCreate(...a),
      update: (...a: unknown[]) => convUpdate(...a),
    },
    message: {
      findMany: (...a: unknown[]) => msgFindMany(...a),
      findFirst: (...a: unknown[]) => msgFindFirst(...a), // guard anti-burst
    },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
  },
}));

const askClaude = vi.fn();
vi.mock("./claude", () => ({
  askClaude: (...a: unknown[]) => askClaude(...a),
  buildSystemPrompt: () => "SYSTEM",
  ESCALATE_TOKEN: "[ESCALAR]",
}));

// getBotConfig toca prisma.botConfig (no mockeado arriba): se mockea aparte con los
// 3 canales habilitados para no interferir con las pruebas de enrutamiento por canal
// (el guard de canales habilitados se prueba por separado en bot-respond.guards.test.ts).
vi.mock("./config", () => ({
  getBotConfig: async () => ({
    botEnabled: true,
    tonePreset: "PROFESIONAL_CALIDO",
    autonomyLevel: "L2",
    model: "claude-sonnet-5",
    openerStyle: "WARM_NAME",
    maxLines: 4,
    dataGateStrict: true,
    escalationTriggers: ["apartar", "queja", "legal_fiscal", "negociacion"],
    enabledChannels: ["WHATSAPP", "INSTAGRAM", "MESSENGER"],
  }),
}));

vi.mock("./brand-linter", () => ({
  lintBrandVoice: () => ({ ok: true, violations: [] }),
}));

vi.mock("./hub-catalog", () => ({
  findMatchingDevelopments: async () => ({ data: [], error: null }),
  catalogBrief: () => "",
}));

// ---

import { botRespond } from "./bot-respond";

const CONTACT = {
  id: "c1",
  firstName: "Ana",
  lastName: "García",
  phone: "+521234567890",
  doNotContact: false,
  whatsappOptOut: false,
  assignedToId: "u-owner",
  budgetMin: null,
  budgetMax: null,
  preferredZone: null,
  preferredLanguage: "es",
};

const CONV = { id: "conv1", status: "BOT", botEnabled: true, connectorId: null };

beforeEach(() => {
  vi.resetAllMocks();
  contactFindUnique.mockResolvedValue(CONTACT);
  convFindFirst.mockResolvedValue(CONV);
  convUpdate.mockResolvedValue({});
  msgFindMany.mockResolvedValue([]);
  msgFindFirst.mockResolvedValue(null); // sin mensajes nuevos durante la generación
  sendChannelMessage.mockResolvedValue({ id: "m1" });
});

describe("botRespond — canal", () => {
  it("envía la respuesta por el dispatcher con el canal indicado (INSTAGRAM)", async () => {
    askClaude.mockResolvedValue("Hola, ¿en qué puedo ayudarte?");
    await botRespond("c1", { channel: "INSTAGRAM" });
    expect(sendChannelMessage).toHaveBeenCalledWith(
      "INSTAGRAM",
      "c1",
      expect.any(String),
      expect.any(String),
      { bot: true, connectorId: null }
    );
  });

  it("usa WHATSAPP por defecto si no se pasa channel", async () => {
    askClaude.mockResolvedValue("Hola desde WhatsApp");
    await botRespond("c1");
    expect(sendChannelMessage).toHaveBeenCalledWith(
      "WHATSAPP",
      "c1",
      expect.any(String),
      expect.any(String),
      { bot: true, connectorId: null }
    );
  });

  it("busca la conversación por el canal correcto", async () => {
    askClaude.mockResolvedValue("Hola Messenger");
    await botRespond("c1", { channel: "MESSENGER" });
    expect(convFindFirst).toHaveBeenCalledWith({
      where: { contactId: "c1", channel: "MESSENGER" },
      orderBy: { lastMessageAt: "desc" },
    });
  });

  it("no envía si no hay conversación BOT activa para ese canal", async () => {
    convFindFirst.mockResolvedValue(null);
    const result = await botRespond("c1", { channel: "INSTAGRAM" });
    expect(result).toBe(false);
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });
});

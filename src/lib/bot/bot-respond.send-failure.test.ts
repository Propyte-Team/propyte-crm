import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks de dependencias externas de bot-respond.ts ---

const sendChannelMessage = vi.fn();
vi.mock("@/lib/messaging/dispatcher", () => ({
  sendChannelMessage: (...a: unknown[]) => sendChannelMessage(...a),
}));

// El texto de la nota y su escritura se prueban en lib/messaging/send-failure.test.ts;
// aquí solo importa CUÁNDO se llama y que el error se siga propagando.
const recordBotSendFailure = vi.fn();
vi.mock("@/lib/messaging/send-failure", () => ({
  recordBotSendFailure: (...a: unknown[]) => recordBotSendFailure(...a),
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
import { GraphSendError } from "@/lib/messaging/graph";

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
  recordBotSendFailure.mockResolvedValue(undefined);
  askClaude.mockResolvedValue("Hola Ana, ¿qué zona te interesa?");
});

// 2026-10-10: un DM a @propytemx se quedó sin respuesta porque Meta rechazó el
// envío (otra app era la dueña del hilo) y no quedaba rastro en el Inbox.
describe("botRespond — envío rechazado por Meta", () => {
  const rechazo = new GraphSendError("Graph send", 400, {
    code: 10,
    message: "(#10) The app is not the thread owner",
  });

  it.each(["INSTAGRAM", "MESSENGER"] as const)(
    "%s: deja la nota en la conversación y relanza el mismo error",
    async (channel) => {
      sendChannelMessage.mockRejectedValue(rechazo);

      await expect(botRespond("c1", { channel })).rejects.toBe(rechazo);

      expect(recordBotSendFailure).toHaveBeenCalledWith({
        contactId: "c1",
        conversationId: "conv1",
        channel,
        err: rechazo,
      });
      // El flujo no cambia: tras un envío fallido no se toca la conversación.
      expect(convUpdate).not.toHaveBeenCalled();
    }
  );

  it("WhatsApp queda como estaba: sin nota, el error se propaga igual", async () => {
    const err = new Error("Meta Cloud API 131047");
    sendChannelMessage.mockRejectedValue(err);
    await expect(botRespond("c1", { channel: "WHATSAPP" })).rejects.toBe(err);
    expect(recordBotSendFailure).not.toHaveBeenCalled();
  });

  it("si el envío sale, no hay nota", async () => {
    await expect(botRespond("c1", { channel: "INSTAGRAM" })).resolves.toBe(true);
    expect(recordBotSendFailure).not.toHaveBeenCalled();
    expect(sendChannelMessage).toHaveBeenCalledTimes(1);
  });
});

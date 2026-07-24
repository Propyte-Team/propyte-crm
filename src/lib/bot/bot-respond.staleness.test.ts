import { describe, it, expect, vi, beforeEach } from "vitest";

// BUG 2026-07-24 (Bunker): texto + 2 PDFs en ráfaga → 3 respuestas del bot.
// Guard anti-burst: si al terminar de generar ya existe un mensaje más nuevo que el
// watermark (último mensaje visto al leer la historia), NO se envía — el trigger del
// mensaje más nuevo responderá con el contexto completo.

const sendChannelMessage = vi.fn();
vi.mock("@/lib/messaging/dispatcher", () => ({
  sendChannelMessage: (...a: unknown[]) => sendChannelMessage(...a),
}));

const contactFindUnique = vi.fn();
const convFindFirst = vi.fn();
const convUpdate = vi.fn();
const msgFindMany = vi.fn();
const msgFindFirst = vi.fn();
const userFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    conversation: {
      findFirst: (...a: unknown[]) => convFindFirst(...a),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: (...a: unknown[]) => convUpdate(...a),
    },
    message: {
      findMany: (...a: unknown[]) => msgFindMany(...a),
      findFirst: (...a: unknown[]) => msgFindFirst(...a),
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

vi.mock("./config", () => ({
  getBotConfig: async () => ({
    botEnabled: true,
    tonePreset: "PROFESIONAL_CALIDO",
    autonomyLevel: "L2",
    model: "claude-sonnet-5",
    openerStyle: "WARM_NAME",
    maxLines: 4,
    dataGateStrict: true,
    escalationTriggers: ["apartar"],
    enabledChannels: ["WHATSAPP", "INSTAGRAM", "MESSENGER"],
  }),
}));

vi.mock("./brand-linter", () => ({ lintBrandVoice: () => ({ ok: true, violations: [] }) }));
vi.mock("./hub-catalog", () => ({ findMatchingDevelopments: async () => [], catalogBrief: () => "" }));

import { botRespond } from "./bot-respond";

const T0 = new Date("2026-07-24T15:00:00.000Z");

const CONTACT = {
  id: "c1",
  firstName: "Bunker",
  lastName: "PDC",
  phone: "+529842036229",
  doNotContact: false,
  whatsappOptOut: false,
  assignedToId: "u-owner",
  budgetMin: null,
  budgetMax: null,
  preferredZone: null,
  preferredLanguage: "ES",
};

beforeEach(() => {
  vi.resetAllMocks();
  contactFindUnique.mockResolvedValue(CONTACT);
  convFindFirst.mockResolvedValue({ id: "conv1", status: "BOT", botEnabled: true, connectorId: null });
  convUpdate.mockResolvedValue({});
  sendChannelMessage.mockResolvedValue({ id: "m-out" });
  askClaude.mockResolvedValue("Respuesta generada");
  msgFindMany.mockResolvedValue([
    { direction: "INBOUND", body: "[Documento: CV.pdf]", createdAt: T0 },
  ]);
  msgFindFirst.mockResolvedValue(null); // default: nada más nuevo
});

describe("botRespond — guard anti-burst (staleness)", () => {
  it("si llegó un mensaje más nuevo mientras generaba, NO envía y regresa false", async () => {
    msgFindFirst.mockResolvedValue({ id: "m-newer" });
    const r = await botRespond("c1");
    expect(r).toBe(false);
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("sin mensajes nuevos → envía normal", async () => {
    const r = await botRespond("c1");
    expect(r).toBe(true);
    expect(sendChannelMessage).toHaveBeenCalledTimes(1);
  });

  it("el chequeo usa el watermark del último mensaje visto (createdAt gt)", async () => {
    await botRespond("c1");
    expect(msgFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contactId: "c1",
          internalNote: false,
          createdAt: { gt: T0 },
        }),
      })
    );
  });

  it("historia vacía (opener): chequea cualquier mensaje nuevo sin filtro de fecha", async () => {
    msgFindMany.mockResolvedValue([]);
    await botRespond("c1");
    const where = msgFindFirst.mock.calls[0][0].where;
    expect(where.createdAt).toBeUndefined();
    expect(where.contactId).toBe("c1");
  });

  it("si el guard detecta mensaje nuevo tampoco escala (el trigger nuevo re-evalúa)", async () => {
    askClaude.mockResolvedValue("Te paso con un asesor [ESCALAR]");
    msgFindFirst.mockResolvedValue({ id: "m-newer" });
    const r = await botRespond("c1");
    expect(r).toBe(false);
    // escalateToHuman abriría conversation.findUnique — no debe ocurrir
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(convUpdate).not.toHaveBeenCalled();
  });
});

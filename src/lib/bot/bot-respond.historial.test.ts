import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks (mismo scaffolding que bot-respond.reclutamiento.test.ts) ---

const sendChannelMessage = vi.fn();
vi.mock("@/lib/messaging/dispatcher", () => ({
  sendChannelMessage: (...a: unknown[]) => sendChannelMessage(...a),
}));

const contactFindUnique = vi.fn();
const convFindFirst = vi.fn();
const msgFindMany = vi.fn();
const userFindFirst = vi.fn();
const agentCount = vi.fn();
const playbookFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    conversation: {
      findFirst: (...a: unknown[]) => convFindFirst(...a),
      update: vi.fn(async () => ({})),
    },
    message: {
      findMany: (...a: unknown[]) => msgFindMany(...a),
      findFirst: vi.fn(async () => null), // guard anti-burst: sin mensajes nuevos
    },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    botAgentProfile: { count: (...a: unknown[]) => agentCount(...a) },
    botPlaybook: { findFirst: (...a: unknown[]) => playbookFindFirst(...a) },
    recruitCandidate: {},
  },
}));

const askClaude = vi.fn();
vi.mock("./claude", () => ({
  askClaude: (...a: unknown[]) => askClaude(...a),
  buildSystemPrompt: () => "SYSTEM",
  ESCALATE_TOKEN: "[ESCALAR]",
}));

const botConfig = {
  botEnabled: true,
  tonePreset: "PROFESIONAL_CALIDO",
  autonomyLevel: "L2",
  model: "claude-sonnet-5",
  openerStyle: "WARM_NAME",
  maxLines: 4,
  dataGateStrict: true,
  escalationTriggers: [],
  enabledChannels: ["WHATSAPP", "INSTAGRAM", "MESSENGER"],
  activePlaybookId: null as string | null,
  classifyContacts: true,
};
vi.mock("./config", () => ({ getBotConfig: async () => ({ ...botConfig }) }));

vi.mock("./brand-linter", () => ({ lintBrandVoice: () => ({ ok: true, violations: [] }) }));
vi.mock("./hub-catalog", () => ({
  findMatchingDevelopments: async () => ({ data: [], error: null }),
  catalogBrief: () => "",
}));

const maybeClassifyContact = vi.fn();
vi.mock("./classify", () => ({ maybeClassifyContact: (...a: unknown[]) => maybeClassifyContact(...a) }));
const selectAgentProfile = vi.fn();
vi.mock("./agent-profiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-profiles")>();
  return { ...actual, selectAgentProfile: (...a: unknown[]) => selectAgentProfile(...a) };
});

const runPlaybookStep = vi.fn();
vi.mock("./playbook/run", () => ({ runPlaybookStep: (...a: unknown[]) => runPlaybookStep(...a) }));

const hookReclutamiento = vi.fn();
vi.mock("@/lib/reclutamiento/hook", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reclutamiento/hook")>();
  return { ...actual, hookReclutamiento: (...a: unknown[]) => hookReclutamiento(...a) };
});

vi.mock("@/lib/brands/resolve", () => ({ resolveBrandForConnector: async () => ({ kind: "default" }), isBrandScoped: () => false }));
vi.mock("@/lib/brands/settings", () => ({ brandEnabledChannels: () => null }));
vi.mock("@/lib/users/actor-sistema", () => ({ resolveActorUserId: async () => "u1" }));
vi.mock("@/lib/whatsapp/coex/advisor-line", () => ({ isAdvisorLine: async () => false }));
vi.mock("@/lib/messaging/send-failure", () => ({ recordBotSendFailure: vi.fn(), recordBotSilence: vi.fn() }));
vi.mock("@/lib/messaging/aviso-sin-dueno", () => ({ avisarHiloSinDueno: vi.fn() }));
vi.mock("./marketing-routing", () => ({ ESCALATE_MARKETING_TOKEN: "[MKT]", getMarketingOwnerId: async () => null }));

import { botRespond } from "./bot-respond";

const CONTACT = {
  id: "k1", firstName: "Ana", lastName: "López", phone: "+5219981234567", email: "ana@example.com",
  contactType: "EMPLEO", custom: {}, doNotContact: false, whatsappOptOut: false, assignedToId: "u1",
  budgetMin: null, budgetMax: null, preferredZone: null, preferredLanguage: "ES",
};
const CONV = { id: "v1", status: "BOT", botEnabled: true, connectorId: null, contactId: "k1" };

beforeEach(() => {
  vi.resetAllMocks();
  contactFindUnique.mockResolvedValue(CONTACT);
  convFindFirst.mockResolvedValue(CONV);
  userFindFirst.mockResolvedValue({ id: "admin1" });
  sendChannelMessage.mockResolvedValue({ id: "m1" });
  askClaude.mockResolvedValue("Gracias, Ana.");
  agentCount.mockResolvedValue(0);
  maybeClassifyContact.mockResolvedValue("EMPLEO");
  selectAgentProfile.mockResolvedValue(null);
  hookReclutamiento.mockResolvedValue({});
  runPlaybookStep.mockResolvedValue({ objective: "x", status: "IN_PROGRESS" });
});

describe("bot-respond — el historial siempre termina en el cliente", () => {
  it("si el mensaje más nuevo es del bot, omite el turno sin llamar a Claude (HTTP 400 prefill)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    msgFindMany.mockResolvedValue([
      // orderBy createdAt desc: el más nuevo primero
      { direction: "OUTBOUND", body: "respuesta", createdAt: new Date(2026, 0, 1, 10, 0, 5), mediaFilename: null },
      { direction: "INBOUND", body: "hola", createdAt: new Date(2026, 0, 1, 10, 0, 0), mediaFilename: null },
    ]);

    const out = await botRespond("k1", { channel: "WHATSAPP" });

    expect(out).toBe(false);
    expect(askClaude).not.toHaveBeenCalled();
    expect(maybeClassifyContact).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("historial termina en mensaje del bot"), { contactId: "k1" });
    info.mockRestore();
  });

  it("si el mensaje más nuevo es del cliente, el turno corre y llama a Claude", async () => {
    msgFindMany.mockResolvedValue([
      { direction: "INBOUND", body: "hola", createdAt: new Date(), mediaFilename: null },
    ]);

    const out = await botRespond("k1", { channel: "WHATSAPP" });

    expect(askClaude).toHaveBeenCalledTimes(1);
    const llamada = askClaude.mock.calls[0][0] as { messages: { role: string; content: string }[] };
    expect(llamada.messages.at(-1)).toEqual({ role: "user", content: "hola" });
    expect(out).toBe(true);
  });
});

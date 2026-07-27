import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks (mismo scaffolding que bot-respond.channel.test.ts + agentes) ---

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
    message: { findMany: (...a: unknown[]) => msgFindMany(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    botAgentProfile: { count: (...a: unknown[]) => agentCount(...a) },
    botPlaybook: { findFirst: (...a: unknown[]) => playbookFindFirst(...a) },
  },
}));

const askClaude = vi.fn();
const systemArgs = vi.fn();
vi.mock("./claude", () => ({
  askClaude: (...a: unknown[]) => askClaude(...a),
  buildSystemPrompt: (args: unknown) => { systemArgs(args); return "SYSTEM"; },
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
vi.mock("./hub-catalog", () => ({ findMatchingDevelopments: async () => [], catalogBrief: () => "" }));

const maybeClassifyContact = vi.fn();
vi.mock("./classify", () => ({ maybeClassifyContact: (...a: unknown[]) => maybeClassifyContact(...a) }));
const selectAgentProfile = vi.fn();
vi.mock("./agent-profiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-profiles")>();
  return { ...actual, selectAgentProfile: (...a: unknown[]) => selectAgentProfile(...a) };
});

const runPlaybookStep = vi.fn();
vi.mock("./playbook/run", () => ({ runPlaybookStep: (...a: unknown[]) => runPlaybookStep(...a) }));

import { botRespond } from "./bot-respond";

const CONTACT = {
  id: "c1", firstName: "Ana", lastName: "García", phone: "+5212345",
  doNotContact: false, whatsappOptOut: false, assignedToId: "u1",
  budgetMin: null, budgetMax: null, preferredZone: null, preferredLanguage: "es",
  contactType: "COMPRADOR", custom: null,
};
const CONV = { id: "conv1", status: "BOT", botEnabled: true, connectorId: null };
const INBOUND = [{ direction: "INBOUND", body: "hola, soy broker", createdAt: new Date() }];

beforeEach(() => {
  vi.resetAllMocks();
  contactFindUnique.mockResolvedValue(CONTACT);
  convFindFirst.mockResolvedValue(CONV);
  msgFindMany.mockResolvedValue(INBOUND);
  userFindFirst.mockResolvedValue({ id: "admin1" });
  sendChannelMessage.mockResolvedValue({ id: "m1" });
  askClaude.mockResolvedValue("Claro, con gusto.");
  agentCount.mockResolvedValue(1);
  maybeClassifyContact.mockResolvedValue("BROKER_EXTERNO");
  selectAgentProfile.mockResolvedValue(null);
});

describe("botRespond — agentes por segmento", () => {
  it("sin agentes activos (count 0) → NO clasifica ni selecciona; responde igual", async () => {
    agentCount.mockResolvedValue(0);
    await botRespond("c1");
    expect(maybeClassifyContact).not.toHaveBeenCalled();
    expect(selectAgentProfile).not.toHaveBeenCalled();
    expect(sendChannelMessage).toHaveBeenCalled();
  });

  it("con agente del segmento → identidad en la capa objetivo + playbook del agente + tono override", async () => {
    selectAgentProfile.mockResolvedValue({
      id: "ap1", name: "Brokers", identity: "IDENTIDAD-BROKERS", tonePreset: "EJECUTIVO_SOBRIO",
      playbook: { id: "pb-brokers", tasks: [{ id: "t1" }] },
    });
    runPlaybookStep.mockResolvedValue({ objective: "OBJ-PLAYBOOK", status: "IN_PROGRESS" });

    await botRespond("c1");

    expect(maybeClassifyContact).toHaveBeenCalledWith(expect.anything(), CONTACT, expect.any(Array), "claude-sonnet-5");
    expect(selectAgentProfile).toHaveBeenCalledWith(expect.anything(), "BROKER_EXTERNO");
    // playbook del agente (no el global, que es null) y sin pasar por botPlaybook.findFirst
    expect(runPlaybookStep).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      playbook: expect.objectContaining({ id: "pb-brokers" }),
    }));
    expect(playbookFindFirst).not.toHaveBeenCalled();
    const args = systemArgs.mock.calls[0][0] as { objective?: string; config: { tonePreset: string } };
    expect(args.objective).toContain("IDENTIDAD-BROKERS");
    expect(args.objective).toContain("OBJ-PLAYBOOK");
    expect(args.config.tonePreset).toBe("EJECUTIVO_SOBRIO");
    expect(sendChannelMessage).toHaveBeenCalled();
  });

  it("agente sin playbook propio → identidad + fallback; sin agente → flujo global intacto", async () => {
    selectAgentProfile.mockResolvedValue({
      id: "ap2", name: "Reclutamiento", identity: "IDENTIDAD-EMPLEO", tonePreset: null, playbook: null,
    });
    await botRespond("c1");
    let args = systemArgs.mock.calls[0][0] as { objective?: string; config: { tonePreset: string } };
    expect(args.objective).toContain("IDENTIDAD-EMPLEO");
    expect(args.config.tonePreset).toBe("PROFESIONAL_CALIDO"); // sin override

    systemArgs.mockClear();
    selectAgentProfile.mockResolvedValue(null);
    await botRespond("c1");
    args = systemArgs.mock.calls[0][0] as { objective?: string; config: { tonePreset: string } };
    expect(args.objective ?? "").not.toContain("IDENTIDAD");
  });

  it("clasificador/selección fallan → responde igual sin agente (defensivo)", async () => {
    maybeClassifyContact.mockImplementation(async () => { throw new Error("boom"); });
    await botRespond("c1");
    expect(sendChannelMessage).toHaveBeenCalled();
    const args = systemArgs.mock.calls[0][0] as { objective?: string };
    expect(args.objective ?? "").not.toContain("IDENTIDAD");
  });
});

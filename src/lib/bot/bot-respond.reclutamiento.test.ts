import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks (mismo scaffolding que bot-respond.agents.test.ts + hook de reclutamiento) ---

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
    // No se usa porque el hook está mockeado; solo para que el import resuelva.
    recruitCandidate: {},
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
const findMatchingDevelopments = vi.fn();
vi.mock("./hub-catalog", () => ({
  findMatchingDevelopments: (...a: unknown[]) => findMatchingDevelopments(...a),
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
const HOLA = [{ direction: "INBOUND", body: "hola", createdAt: new Date(), mediaFilename: null }];

const agenteReclutamiento = {
  id: "a1", name: "Agente Reclutamiento", identity: "Eres reclutador.", tonePreset: null, priority: 30,
  playbook: {
    id: "p1", deletedAt: null,
    tasks: [
      { key: "nombre", order: 0, objective: "nombre", targetField: "firstName", captureType: "FULL_NAME", enumOptions: [], required: true, skipIfFilled: true, isActive: true },
      // Marca del guion nuevo: sin esta tarea el hook no corre (ver test «playbook viejo»).
      { key: "actitud_3", order: 1, objective: "actitud", targetField: "custom.reclutamiento_actitud_3", captureType: "TEXT", enumOptions: [], required: true, skipIfFilled: true, isActive: true },
    ],
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  contactFindUnique.mockResolvedValue(CONTACT);
  convFindFirst.mockResolvedValue(CONV);
  msgFindMany.mockResolvedValue(HOLA);
  userFindFirst.mockResolvedValue({ id: "admin1" });
  sendChannelMessage.mockResolvedValue({ id: "m1" });
  askClaude.mockResolvedValue("Gracias, Ana.");
  agentCount.mockResolvedValue(1);
  maybeClassifyContact.mockResolvedValue("EMPLEO");
  selectAgentProfile.mockResolvedValue(agenteReclutamiento);
  hookReclutamiento.mockResolvedValue({});
  findMatchingDevelopments.mockResolvedValue({ data: [], error: null });
});

describe("bot-respond + reclutamiento", () => {
  it("con el agente de reclutamiento llama al hook y usa su objetivo de cierre", async () => {
    runPlaybookStep.mockResolvedValue({ objective: "Ya tienes lo esencial…", status: "COMPLETED" });
    hookReclutamiento.mockResolvedValue({ objetivo: "CIERRE APTO" });

    await botRespond("k1", { channel: "INSTAGRAM" });

    expect(hookReclutamiento).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "v1",
      channel: "INSTAGRAM",
      model: "claude-sonnet-5",
      playbook: { status: "COMPLETED" },
      // Enmienda 926: el hook necesita estos campos del contacto para crear el candidato.
      contact: expect.objectContaining({ id: "k1", firstName: "Ana", lastName: "López", phone: "+5219981234567", email: "ana@example.com", custom: {} }),
    }));
    const sys = systemArgs.mock.calls[0][0] as { objective: string };
    expect(sys.objective).toContain("CIERRE APTO");
    expect(sys.objective).not.toContain("Ya tienes lo esencial");
    expect(sys.objective).toContain("Eres reclutador.");
  });

  it("tras el cierre, objetivo y contexto van juntos: el cierre primero y la ficha después", async () => {
    runPlaybookStep.mockResolvedValue({ objective: "Ya tienes lo esencial…", status: "COMPLETED" });
    hookReclutamiento.mockResolvedValue({ objetivo: "CIERRE APTO", contexto: "Ficha de la vacante: oficinas en Mérida" });

    await botRespond("k1", { channel: "INSTAGRAM" });

    const sys = systemArgs.mock.calls[0][0] as { objective: string };
    expect(sys.objective).toContain("CIERRE APTO\n\nFicha de la vacante: oficinas en Mérida");
    expect(sys.objective).not.toContain("Ya tienes lo esencial");
  });

  it("mientras el guion sigue, el contexto del hook se suma al objetivo del playbook", async () => {
    runPlaybookStep.mockResolvedValue({ objective: "Tu meta ahora: pide su nombre", status: "IN_PROGRESS" });
    hookReclutamiento.mockResolvedValue({ contexto: "Ficha: 100 % comisión" });

    await botRespond("k1", { channel: "MESSENGER" });

    const sys = systemArgs.mock.calls[0][0] as { objective: string };
    expect(sys.objective).toContain("pide su nombre");
    expect(sys.objective).toContain("Ficha: 100 % comisión");
  });

  it("si el playbook no dio objetivo (fallo defensivo), el contexto del hook se anexa igual", async () => {
    runPlaybookStep.mockResolvedValue({ objective: undefined, status: "IN_PROGRESS" });
    hookReclutamiento.mockResolvedValue({ contexto: "Reglas del guion: no cierres." });

    await botRespond("k1", { channel: "INSTAGRAM" });

    const sys = systemArgs.mock.calls[0][0] as { objective: string };
    expect(sys.objective).toContain("Reglas del guion: no cierres.");
    expect(sys.objective).toContain("Eres reclutador.");
  });

  it("al agente de reclutamiento NO se le pasa el catálogo de ventas (así inventó Ancestral y Gran Coralia)", async () => {
    runPlaybookStep.mockResolvedValue({ objective: "x", status: "IN_PROGRESS" });

    await botRespond("k1", { channel: "INSTAGRAM" });

    expect(findMatchingDevelopments).not.toHaveBeenCalled();
    const sys = systemArgs.mock.calls[0][0] as { catalog: unknown[] };
    expect(sys.catalog).toEqual([]);
  });

  it("a otro agente sí se le consulta el catálogo de ventas, como siempre", async () => {
    selectAgentProfile.mockResolvedValue({ ...agenteReclutamiento, name: "Agente Brokers" });
    runPlaybookStep.mockResolvedValue({ objective: "x", status: "IN_PROGRESS" });

    await botRespond("k1", { channel: "INSTAGRAM" });

    expect(findMatchingDevelopments).toHaveBeenCalledTimes(1);
  });

  it("con el playbook viejo (sin actitud_3) no llama al hook aunque sea el agente de reclutamiento", async () => {
    selectAgentProfile.mockResolvedValue({
      ...agenteReclutamiento,
      playbook: { ...agenteReclutamiento.playbook, tasks: agenteReclutamiento.playbook.tasks.filter((t) => t.key !== "actitud_3") },
    });
    runPlaybookStep.mockResolvedValue({ objective: "x", status: "COMPLETED" });

    await botRespond("k1", { channel: "INSTAGRAM" });

    expect(hookReclutamiento).not.toHaveBeenCalled();
  });

  it("con otro agente no llama al hook", async () => {
    selectAgentProfile.mockResolvedValue({ ...agenteReclutamiento, name: "Agente Brokers" });
    runPlaybookStep.mockResolvedValue({ objective: "x", status: "IN_PROGRESS" });

    await botRespond("k1", { channel: "INSTAGRAM" });

    expect(hookReclutamiento).not.toHaveBeenCalled();
  });

  it("un mensaje con adjunto y sin texto aparece en el historial como [adjunto: nombre]", async () => {
    msgFindMany.mockResolvedValue([
      { direction: "INBOUND", body: "", mediaFilename: "cv.pdf", createdAt: new Date() },
    ]);
    runPlaybookStep.mockResolvedValue({ objective: "x", status: "IN_PROGRESS" });

    await botRespond("k1", { channel: "INSTAGRAM" });

    const llamada = askClaude.mock.calls[0][0] as { messages: { content: string }[] };
    expect(llamada.messages[0].content).toBe("[adjunto: cv.pdf]");
  });

  it("un adjunto sin nombre de archivo (IG/Messenger) aparece como [adjunto: tipo]", async () => {
    msgFindMany.mockResolvedValue([
      { direction: "INBOUND", body: "", mediaFilename: null, mediaUrl: "2026-11/x.pdf", mediaType: "document", createdAt: new Date() },
    ]);
    runPlaybookStep.mockResolvedValue({ objective: "x", status: "IN_PROGRESS" });

    await botRespond("k1", { channel: "MESSENGER" });

    const llamada = askClaude.mock.calls[0][0] as { messages: { content: string }[] };
    expect(llamada.messages[0].content).toBe("[adjunto: document]");
  });
});

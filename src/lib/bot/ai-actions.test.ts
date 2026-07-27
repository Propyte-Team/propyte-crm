import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks de dependencias externas de ai-actions.ts ---

const messageFindMany = vi.fn();
const activityCreate = vi.fn();
const notificationCreate = vi.fn();
const convPlaybookStateFindUnique = vi.fn();
const convPlaybookStateUpdate = vi.fn();
const convPlaybookStateUpsert = vi.fn();
const botPlaybookFindFirst = vi.fn();
const contactUpdate = vi.fn();
const auditLogCreate = vi.fn();
const agentCount = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    message: { findMany: (...a: unknown[]) => messageFindMany(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
    conversationPlaybookState: {
      findUnique: (...a: unknown[]) => convPlaybookStateFindUnique(...a),
      update: (...a: unknown[]) => convPlaybookStateUpdate(...a),
      upsert: (...a: unknown[]) => convPlaybookStateUpsert(...a),
    },
    botPlaybook: { findFirst: (...a: unknown[]) => botPlaybookFindFirst(...a) },
    contact: { update: (...a: unknown[]) => contactUpdate(...a) },
    auditLog: { create: (...a: unknown[]) => auditLogCreate(...a) },
    botAgentProfile: { count: (...a: unknown[]) => agentCount(...a) },
  },
}));

// selectAgentProfile se mockea; applyAgentTone/composeObjective/agentPlaybookOf (puros)
// quedan reales para poder inspeccionar el ensamblado de verdad (mismo patrón que
// bot-respond.agents.test.ts).
const selectAgentProfile = vi.fn();
vi.mock("./agent-profiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-profiles")>();
  return { ...actual, selectAgentProfile: (...a: unknown[]) => selectAgentProfile(...a) };
});

const getBotConfig = vi.fn();
vi.mock("./config", () => ({ getBotConfig: (...a: unknown[]) => getBotConfig(...a) }));

const findMatchingDevelopments = vi.fn();
vi.mock("./hub-catalog", () => ({
  findMatchingDevelopments: (...a: unknown[]) => findMatchingDevelopments(...a),
  catalogBrief: () => "",
}));

const lintBrandVoice = vi.fn((..._a: unknown[]) => ({ ok: true, violations: [] as string[] }));
vi.mock("./brand-linter", () => ({ lintBrandVoice: (...a: unknown[]) => lintBrandVoice(...a) }));

const findConversationForChannel = vi.fn();
vi.mock("@/lib/messaging/conversations", () => ({
  findConversationForChannel: (...a: unknown[]) => findConversationForChannel(...a),
}));

// buildSystemPrompt/thinkingFieldFor/etc. quedan REALES (son puros) — solo se mockea
// askClaude para no llamar a la API de Anthropic. Así podemos inspeccionar el "system"
// ensamblado de verdad (marca+tono+objetivo+catálogo) que le llega al modelo.
const askClaude = vi.fn();
vi.mock("./claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./claude")>();
  return { ...actual, askClaude: (...a: unknown[]) => askClaude(...a) };
});

// ---

import { runAiAction } from "./ai-actions";
import type { Contact } from "@prisma/client";

const CONTACT = {
  id: "c1",
  firstName: "Ana",
  lastName: "García",
  preferredLanguage: "ES",
  budgetMin: null,
  budgetMax: null,
  preferredZone: null,
  purchaseTimeline: null,
  assignedToId: "u1",
} as unknown as Contact;

const BASE_CONFIG = {
  botEnabled: true,
  tonePreset: "PROFESIONAL_CALIDO",
  autonomyLevel: "L1",
  model: "claude-test-model",
  openerStyle: "WARM_NAME",
  maxLines: 4,
  dataGateStrict: true,
  escalationTriggers: ["apartar"],
  enabledChannels: ["WHATSAPP"],
  activePlaybookId: null as string | null,
};

const TASK_A = {
  key: "a",
  order: 1,
  objective: "confirmar zona de interés",
  targetField: "preferredZone",
  required: true,
  skipIfFilled: true,
  captureType: "ZONE",
  enumOptions: [],
};
const TASK_B = {
  key: "b",
  order: 2,
  objective: "confirmar presupuesto",
  targetField: "budgetMax",
  required: true,
  skipIfFilled: true,
  captureType: "MONEY",
  enumOptions: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  getBotConfig.mockResolvedValue({ ...BASE_CONFIG });
  findMatchingDevelopments.mockResolvedValue([]);
  messageFindMany.mockResolvedValue([]);
  lintBrandVoice.mockReturnValue({ ok: true, violations: [] });
  askClaude.mockResolvedValue("Hola Ana, este es tu borrador.");
  agentCount.mockResolvedValue(0);
  selectAgentProfile.mockResolvedValue(null);
});

describe("runAiAction(AI_DRAFT) — ensamblado en 4 capas", () => {
  it("sin playbook activo: usa el goal original como objetivo y no toca el estado de playbook", async () => {
    const result = await runAiAction("AI_DRAFT", CONTACT, { kind: "reactivacion" });

    expect(result).toEqual({});
    expect(convPlaybookStateFindUnique).not.toHaveBeenCalled();
    expect(botPlaybookFindFirst).not.toHaveBeenCalled();

    const system = askClaude.mock.calls[0][0].system as string;
    expect(system).toContain("Propyte"); // capa marca
    expect(system).toContain("reactivacion"); // goal original preservado
    expect(system).toContain("ASESOR"); // sigue siendo un borrador, no un envío directo

    expect(askClaude.mock.calls[0][0].model).toBe("claude-test-model"); // model de la config

    expect(activityCreate).toHaveBeenCalledTimes(1);
    expect(activityCreate.mock.calls[0][0].data.description).toBe("Hola Ana, este es tu borrador.");
    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });

  it("usa findMatchingDevelopments con budget/zona del contacto (igual que bot-respond)", async () => {
    const contact = { ...CONTACT, budgetMin: 100, budgetMax: 200, preferredZone: "Tulum" } as unknown as Contact;
    await runAiAction("AI_DRAFT", contact, { kind: "seguimiento" });
    expect(findMatchingDevelopments).toHaveBeenCalledWith({ budgetMin: 100, budgetMax: 200, zone: "Tulum" });
  });

  it("con playbook activo y estado con tarea pendiente: usa nextTask/buildObjective en modo lectura", async () => {
    getBotConfig.mockResolvedValue({ ...BASE_CONFIG, activePlaybookId: "pb1" });
    findConversationForChannel.mockResolvedValue({ id: "conv1" });
    convPlaybookStateFindUnique.mockResolvedValue({ conversationId: "conv1", completedTaskKeys: ["a"] });
    botPlaybookFindFirst.mockResolvedValue({ id: "pb1", tasks: [TASK_A, TASK_B] });

    await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

    expect(convPlaybookStateFindUnique).toHaveBeenCalledWith({ where: { conversationId: "conv1" } });

    const system = askClaude.mock.calls[0][0].system as string;
    expect(system).toContain("confirmar presupuesto"); // objetivo de TASK_B (la "a" ya está completada)
    expect(system).not.toContain("Objetivo ahora: Redacta"); // ya NO es el objetivo fallback

    // Solo lectura: ningún write de playbook/contacto/auditoría
    expect(convPlaybookStateUpdate).not.toHaveBeenCalled();
    expect(convPlaybookStateUpsert).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it("con playbook activo y todas las tareas completadas: usa COMPLETION_OBJECTIVE", async () => {
    getBotConfig.mockResolvedValue({ ...BASE_CONFIG, activePlaybookId: "pb1" });
    findConversationForChannel.mockResolvedValue({ id: "conv1" });
    convPlaybookStateFindUnique.mockResolvedValue({ conversationId: "conv1", completedTaskKeys: ["a", "b"] });
    botPlaybookFindFirst.mockResolvedValue({ id: "pb1", tasks: [TASK_A, TASK_B] });

    await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

    const system = askClaude.mock.calls[0][0].system as string;
    expect(system).toContain("Ya tienes lo esencial del lead"); // COMPLETION_OBJECTIVE

    expect(convPlaybookStateUpdate).not.toHaveBeenCalled();
    expect(convPlaybookStateUpsert).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it("playbook activo pero la conversación NUNCA arrancó playbook (sin estado): no lo inicia, cae al fallback", async () => {
    getBotConfig.mockResolvedValue({ ...BASE_CONFIG, activePlaybookId: "pb1" });
    findConversationForChannel.mockResolvedValue({ id: "conv1" });
    convPlaybookStateFindUnique.mockResolvedValue(null);

    await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

    // Nunca crea el estado desde el borrador (sería un write)
    expect(botPlaybookFindFirst).not.toHaveBeenCalled();
    expect(convPlaybookStateUpsert).not.toHaveBeenCalled();
    expect(convPlaybookStateUpdate).not.toHaveBeenCalled();

    const system = askClaude.mock.calls[0][0].system as string;
    expect(system).toContain("seguimiento"); // objetivo fallback (goal original)
  });

  it("playbook activo pero sin conversación todavía: no busca estado, cae al fallback", async () => {
    getBotConfig.mockResolvedValue({ ...BASE_CONFIG, activePlaybookId: "pb1" });
    findConversationForChannel.mockResolvedValue(null);

    await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

    expect(convPlaybookStateFindUnique).not.toHaveBeenCalled();
    const system = askClaude.mock.calls[0][0].system as string;
    expect(system).toContain("seguimiento");
  });

  it("error leyendo playbook/estado degrada al fallback sin romper el borrador", async () => {
    getBotConfig.mockResolvedValue({ ...BASE_CONFIG, activePlaybookId: "pb1" });
    findConversationForChannel.mockRejectedValue(new Error("boom"));

    const result = await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

    expect(result).toEqual({});
    expect(activityCreate).toHaveBeenCalledTimes(1);
    const system = askClaude.mock.calls[0][0].system as string;
    expect(system).toContain("seguimiento");
  });

  it("brand linter bloqueando el borrador no crea Activity/Notification", async () => {
    lintBrandVoice.mockReturnValue({ ok: false, violations: ["hype"] });
    const result = await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });
    expect(result).toEqual({ skipped: true, note: "Brand linter bloqueó el borrador: hype" });
    expect(activityCreate).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});

describe("runAiAction(AI_DRAFT) — agente por segmento (Frente 4, sin clasificar)", () => {
  const CONTACT_BROKER = { ...CONTACT, contactType: "BROKER_EXTERNO" } as unknown as Contact;

  it("sin agentes activos (count 0) → NO selecciona agente; comportamiento global intacto", async () => {
    agentCount.mockResolvedValue(0);
    await runAiAction("AI_DRAFT", CONTACT_BROKER, { kind: "seguimiento" });
    expect(selectAgentProfile).not.toHaveBeenCalled();
    const system = askClaude.mock.calls[0][0].system as string;
    expect(system).not.toContain("IDENTIDAD");
  });

  it("con agente activo del segmento con tonePreset → override de tono en el system prompt", async () => {
    agentCount.mockResolvedValue(1);
    selectAgentProfile.mockResolvedValue({
      id: "ap1", name: "Brokers", identity: "IDENTIDAD-BROKERS", tonePreset: "EJECUTIVO_SOBRIO", playbook: null,
    });

    await runAiAction("AI_DRAFT", CONTACT_BROKER, { kind: "seguimiento" });

    expect(selectAgentProfile).toHaveBeenCalledWith(expect.anything(), "BROKER_EXTERNO");
    const system = askClaude.mock.calls[0][0].system as string;
    expect(system).toContain("Trato de usted."); // voiceGuidance de EJECUTIVO_SOBRIO
  });

  it("NO clasifica: selectAgentProfile se llama con el contactType actual, sin tocar el clasificador", async () => {
    agentCount.mockResolvedValue(1);
    selectAgentProfile.mockResolvedValue(null);
    await runAiAction("AI_DRAFT", CONTACT_BROKER, { kind: "seguimiento" });
    expect(selectAgentProfile).toHaveBeenCalledWith(expect.anything(), "BROKER_EXTERNO");
  });

  it("identidad del agente antecede al objetivo del borrador", async () => {
    agentCount.mockResolvedValue(1);
    selectAgentProfile.mockResolvedValue({
      id: "ap2", name: "Reclutamiento", identity: "IDENTIDAD-EMPLEO", tonePreset: null, playbook: null,
    });

    await runAiAction("AI_DRAFT", CONTACT_BROKER, { kind: "seguimiento" });

    const system = askClaude.mock.calls[0][0].system as string;
    expect(system).toContain("IDENTIDAD-EMPLEO");
    expect(system).toContain("seguimiento"); // el objetivo base sigue presente
    expect(system.indexOf("IDENTIDAD-EMPLEO")).toBeLessThan(system.indexOf("seguimiento"));
  });

  it("agente con playbook propio y estado con tarea pendiente → usa el playbook del AGENTE, no el global (solo lectura)", async () => {
    agentCount.mockResolvedValue(1);
    selectAgentProfile.mockResolvedValue({
      id: "ap3", name: "Brokers", identity: "IDENTIDAD-BROKERS", tonePreset: null,
      playbook: { id: "pb-agent", tasks: [TASK_A, TASK_B] },
    });
    findConversationForChannel.mockResolvedValue({ id: "conv1" });
    convPlaybookStateFindUnique.mockResolvedValue({ conversationId: "conv1", completedTaskKeys: ["a"] });

    await runAiAction("AI_DRAFT", CONTACT_BROKER, { kind: "seguimiento" });

    expect(botPlaybookFindFirst).not.toHaveBeenCalled(); // usa el del agente, no consulta el global
    const system = askClaude.mock.calls[0][0].system as string;
    expect(system).toContain("confirmar presupuesto"); // objetivo de TASK_B ("a" ya completada)
    expect(system).toContain("IDENTIDAD-BROKERS");

    // Solo lectura: ningún write de playbook/contacto/auditoría
    expect(convPlaybookStateUpdate).not.toHaveBeenCalled();
    expect(convPlaybookStateUpsert).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it("selectAgentProfile falla → degrada al comportamiento global, el borrador se genera igual", async () => {
    agentCount.mockResolvedValue(1);
    selectAgentProfile.mockRejectedValue(new Error("boom"));

    const result = await runAiAction("AI_DRAFT", CONTACT_BROKER, { kind: "seguimiento" });

    expect(result).toEqual({});
    const system = askClaude.mock.calls[0][0].system as string;
    expect(system).not.toContain("IDENTIDAD");
  });
});

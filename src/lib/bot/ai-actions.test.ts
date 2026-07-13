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
  },
}));

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

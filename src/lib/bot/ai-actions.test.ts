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
// findMatchingDevelopments ahora devuelve { data, error } — el mock por defecto
// (beforeEach) refleja un catálogo vacío legítimo, no un fallo de consulta.

const lintBrandVoice = vi.fn((..._a: unknown[]) => ({ ok: true, violations: [] as string[] }));
vi.mock("./brand-linter", () => ({ lintBrandVoice: (...a: unknown[]) => lintBrandVoice(...a) }));

const findConversationForChannel = vi.fn();
vi.mock("@/lib/messaging/conversations", () => ({
  findConversationForChannel: (...a: unknown[]) => findConversationForChannel(...a),
}));

// buildSystemPrompt/thinkingFieldFor/etc. quedan REALES (son puros) — solo se mockea
// askClaude para no llamar a la API de Anthropic. Así podemos inspeccionar el "system"
// ensamblado de verdad (marca+tono+objetivo+catálogo) que le llega al modelo.
// buildSystemPrompt se envuelve con un espía que SIGUE llamando al real (el espía se reinicia
// con resetAllMocks, el real no), para poder afirmar los argumentos exactos (p. ej. `brand`).
const askClaude = vi.fn();
const buildSystemPromptSpy = vi.fn();
vi.mock("./claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./claude")>();
  return {
    ...actual,
    askClaude: (...a: unknown[]) => askClaude(...a),
    buildSystemPrompt: (...a: Parameters<typeof actual.buildSystemPrompt>) => {
      buildSystemPromptSpy(...a);
      return actual.buildSystemPrompt(...a);
    },
  };
});

// Marca de la conversación más reciente del contacto (2026-10-09, spec marcas-agente §3.5).
const resolveForContactMock = vi.fn();
vi.mock("@/lib/brands/resolve", () => ({
  resolveBrandForContact: (...a: unknown[]) => resolveForContactMock(...a),
}));

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
  findMatchingDevelopments.mockResolvedValue({ data: [], error: null });
  messageFindMany.mockResolvedValue([]);
  lintBrandVoice.mockReturnValue({ ok: true, violations: [] });
  askClaude.mockResolvedValue("Hola Ana, este es tu borrador.");
  agentCount.mockResolvedValue(0);
  selectAgentProfile.mockResolvedValue(null);
  // Sin marca por defecto: el comportamiento de siempre.
  resolveForContactMock.mockResolvedValue({ resolution: { kind: "default" }, conversationId: null });
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

// Marca de la conversación más reciente del contacto (2026-10-09, spec marcas-agente §3.5).
// Con marca: historial solo de ESA conversación, sin agentes por segmento, catálogo y
// prompt de la marca, y el playbook de la marca (sin heredar el global). Sin marca o con la
// predeterminada, todo igual que antes (cubierto también por los describe de arriba).
describe("runAiAction(AI_DRAFT) — marca de la conversación más reciente", () => {
  const YAX = {
    id: "b-yax",
    name: "Yaxnáh Caucel",
    isDefault: false,
    persona: "Eres el asistente de Yaxnáh.",
    knowledge: "Info oficial de Yaxnáh.",
    developmentIds: ["dev-yax"],
    tonePreset: "CALIDO_CERCANO_MX",
    playbookId: null as string | null,
    botEnabled: true,
    deletedAt: null,
  };
  const withBrand = (brand: Record<string, unknown> = YAX) =>
    resolveForContactMock.mockResolvedValue({ resolution: { kind: "brand", brand }, conversationId: "conv-y" });

  it("con marca: el historial es solo de la conversación, no de todo el contacto", async () => {
    withBrand();
    await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

    expect(resolveForContactMock).toHaveBeenCalledWith("c1");
    expect(messageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: "conv-y", internalNote: false } }),
    );
  });

  it("con marca: NO selecciona agente por segmento, aunque haya agentes activos", async () => {
    withBrand();
    agentCount.mockResolvedValue(1);
    selectAgentProfile.mockResolvedValue({
      id: "ap1", name: "Brokers", identity: "IDENTIDAD-BROKERS", tonePreset: null, playbook: null,
    });

    await runAiAction("AI_DRAFT", { ...CONTACT, contactType: "BROKER_EXTERNO" } as unknown as Contact, {
      kind: "seguimiento",
    });

    expect(agentCount).not.toHaveBeenCalled();
    expect(selectAgentProfile).not.toHaveBeenCalled();
    expect(askClaude.mock.calls[0][0].system).not.toContain("IDENTIDAD-BROKERS");
  });

  it("con marca: el catálogo sale de developmentIds de la marca, sin presupuesto ni zona del contacto", async () => {
    withBrand();
    const contact = { ...CONTACT, budgetMin: 100, budgetMax: 200, preferredZone: "Tulum" } as unknown as Contact;

    await runAiAction("AI_DRAFT", contact, { kind: "seguimiento" });

    expect(findMatchingDevelopments).toHaveBeenCalledTimes(1);
    expect(findMatchingDevelopments).toHaveBeenCalledWith({ developmentIds: YAX.developmentIds, limit: 10 });
  });

  it("con marca: buildSystemPrompt recibe brand { name, persona, knowledge } y el tono propio de la marca", async () => {
    withBrand();
    await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

    const args = buildSystemPromptSpy.mock.calls[0][0];
    expect(args.brand).toEqual({ name: YAX.name, persona: YAX.persona, knowledge: YAX.knowledge });
    expect(args.config.tonePreset).toBe("CALIDO_CERCANO_MX"); // brand.tonePreset gana al global
    const system = askClaude.mock.calls[0][0].system as string;
    expect(system).toContain("Yaxnáh Caucel");
    expect(system).toContain("Hablas como un buen asesor mexicano"); // voiceGuidance de CALIDO_CERCANO_MX
  });

  it("con marca sin tonePreset propio: usa el tono global", async () => {
    withBrand({ ...YAX, tonePreset: null });
    await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

    expect(buildSystemPromptSpy.mock.calls[0][0].config.tonePreset).toBe("PROFESIONAL_CALIDO");
  });

  it("con marca: el borrador se genera y se entrega igual (Activity + Notification)", async () => {
    withBrand();
    const result = await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

    expect(result).toEqual({});
    expect(activityCreate).toHaveBeenCalledTimes(1);
    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });

  it("marca no disponible (unavailable) → skipped y NO llama a Claude", async () => {
    resolveForContactMock.mockResolvedValue({ resolution: { kind: "unavailable", brandId: "x" }, conversationId: "c" });

    const result = await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

    expect(result).toEqual({ skipped: true, note: "Marca de la cuenta no disponible" });
    expect(askClaude).not.toHaveBeenCalled();
    expect(activityCreate).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("resolveBrandForContact lanza → falla cerrado: skipped, console.error y NO llama a Claude", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    resolveForContactMock.mockRejectedValue(new Error("db caída"));

    const result = await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

    expect(result).toEqual({ skipped: true, note: "Marca de la cuenta no disponible" });
    expect(errSpy).toHaveBeenCalled();
    expect(askClaude).not.toHaveBeenCalled();
    expect(activityCreate).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("marca resuelta pero SIN conversationId → falla cerrado: skipped y NO llama a Claude", async () => {
    // Defensivo: la marca sale de una conversación, así que no debería pasar; si pasara no hay
    // hilo de la marca y NO se debe caer al historial de todo el contacto.
    resolveForContactMock.mockResolvedValue({ resolution: { kind: "brand", brand: YAX }, conversationId: null });

    const result = await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

    expect(result).toEqual({ skipped: true, note: "Marca de la cuenta no disponible" });
    expect(messageFindMany).not.toHaveBeenCalled();
    expect(askClaude).not.toHaveBeenCalled();
    expect(activityCreate).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("con marca: el brief del objetivo NO lleva la zona ni el presupuesto del contacto (pueden ser de otra marca)", async () => {
    withBrand(); // marca sin playbook (el caso común) → objetivo fallback con el brief del contacto
    const contact = {
      ...CONTACT, budgetMin: 1234567, budgetMax: 7654321, preferredZone: "Tulum", purchaseTimeline: "3 meses",
    } as unknown as Contact;

    await runAiAction("AI_DRAFT", contact, { kind: "seguimiento" });

    const system = askClaude.mock.calls[0][0].system as string;
    expect(system).not.toContain("Tulum");
    expect(system).not.toContain("1234567");
    expect(system).not.toContain("7654321");
    expect(system).not.toContain("Zona de interés");
    expect(system).not.toContain("Presupuesto:");
    // El resto del brief se conserva (incluido el horizonte).
    expect(system).toContain("Cliente: Ana García");
    expect(system).toContain("Horizonte: 3 meses");
  });

  it("sin marca: el brief del objetivo conserva zona y presupuesto, igual que hoy", async () => {
    const contact = {
      ...CONTACT, budgetMin: 1234567, budgetMax: 7654321, preferredZone: "Tulum", purchaseTimeline: "3 meses",
    } as unknown as Contact;

    await runAiAction("AI_DRAFT", contact, { kind: "seguimiento" });

    const system = askClaude.mock.calls[0][0].system as string;
    expect(system).toContain("Presupuesto: 1234567 - 7654321 MXN");
    expect(system).toContain("Zona de interés: Tulum");
    expect(system).toContain("Horizonte: 3 meses");
  });

  it("marca predeterminada / sin marca: comportamiento de hoy (historial por contacto, sin `brand`)", async () => {
    resolveForContactMock.mockResolvedValue({ resolution: { kind: "default" }, conversationId: null });
    const contact = { ...CONTACT, budgetMin: 100, budgetMax: 200, preferredZone: "Tulum" } as unknown as Contact;

    await runAiAction("AI_DRAFT", contact, { kind: "seguimiento" });

    expect(messageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contactId: "c1", internalNote: false } }),
    );
    expect(findMatchingDevelopments).toHaveBeenCalledWith({ budgetMin: 100, budgetMax: 200, zone: "Tulum" });
    const args = buildSystemPromptSpy.mock.calls[0][0];
    expect(args.brand).toBeUndefined();
    expect("brand" in args).toBe(false); // sin la clave: el prompt no cambia ni un byte
  });

  it("default con conversationId presente: igual el historial es por contacto (solo una marca lo restringe)", async () => {
    resolveForContactMock.mockResolvedValue({ resolution: { kind: "default" }, conversationId: "conv-d" });

    await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

    expect(messageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contactId: "c1", internalNote: false } }),
    );
  });

  describe("playbook de la marca", () => {
    it("con brand.playbookId: carga ESE playbook (misma consulta que el global) y calcula el objetivo en modo lectura", async () => {
      withBrand({ ...YAX, playbookId: "pb-yax" });
      getBotConfig.mockResolvedValue({ ...BASE_CONFIG, activePlaybookId: "pb-global" });
      botPlaybookFindFirst.mockResolvedValue({ id: "pb-yax", tasks: [TASK_A, TASK_B] });
      // Otro hilo del contacto (otra cuenta): si se usara, el estado saldría de ahí.
      findConversationForChannel.mockResolvedValue({ id: "conv-otra-cuenta" });
      convPlaybookStateFindUnique.mockResolvedValue({
        conversationId: "conv-y", playbookId: "pb-yax", completedTaskKeys: ["a"],
      });

      await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

      expect(botPlaybookFindFirst).toHaveBeenCalledTimes(1); // solo el de la marca, nunca el global
      expect(botPlaybookFindFirst).toHaveBeenCalledWith({
        where: { id: "pb-yax", isActive: true, deletedAt: null },
        include: { tasks: { where: { isActive: true }, orderBy: { order: "asc" } } },
      });
      // El estado sale del hilo de la marca (conversationId de resolveBrandForContact),
      // nunca de findConversationForChannel (que mira todas las cuentas del contacto).
      expect(findConversationForChannel).not.toHaveBeenCalled();
      expect(convPlaybookStateFindUnique).toHaveBeenCalledWith({ where: { conversationId: "conv-y" } });
      const system = askClaude.mock.calls[0][0].system as string;
      expect(system).toContain("confirmar presupuesto"); // TASK_B ("a" ya completada)

      // Solo lectura
      expect(convPlaybookStateUpdate).not.toHaveBeenCalled();
      expect(convPlaybookStateUpsert).not.toHaveBeenCalled();
      expect(contactUpdate).not.toHaveBeenCalled();
      expect(auditLogCreate).not.toHaveBeenCalled();
    });

    it("estado del hilo de la marca pero de OTRO playbook: se ignora (sin estado) y cae al fallback", async () => {
      withBrand({ ...YAX, playbookId: "pb-yax" });
      botPlaybookFindFirst.mockResolvedValue({ id: "pb-yax", tasks: [TASK_A, TASK_B] });
      convPlaybookStateFindUnique.mockResolvedValue({
        conversationId: "conv-y", playbookId: "pb-global", completedTaskKeys: ["a"],
      });

      const result = await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

      expect(result).toEqual({});
      expect(convPlaybookStateFindUnique).toHaveBeenCalledWith({ where: { conversationId: "conv-y" } });
      const system = askClaude.mock.calls[0][0].system as string;
      expect(system).not.toContain("confirmar presupuesto"); // no avanza con completedTaskKeys de otro playbook
      expect(system).not.toContain("confirmar zona de interés");
      expect(system).toContain("seguimiento"); // objetivo fallback (goal original)
    });

    it("marca SIN playbookId: no hereda el playbook global (aunque haya uno activo)", async () => {
      withBrand({ ...YAX, playbookId: null });
      getBotConfig.mockResolvedValue({ ...BASE_CONFIG, activePlaybookId: "pb-global" });
      findConversationForChannel.mockResolvedValue({ id: "conv1" });
      convPlaybookStateFindUnique.mockResolvedValue({
        conversationId: "conv-y", playbookId: "pb-global", completedTaskKeys: [],
      });
      botPlaybookFindFirst.mockResolvedValue({ id: "pb-global", tasks: [TASK_A, TASK_B] });

      await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

      expect(botPlaybookFindFirst).not.toHaveBeenCalled();
      expect(findConversationForChannel).not.toHaveBeenCalled();
      const system = askClaude.mock.calls[0][0].system as string;
      expect(system).not.toContain("confirmar zona de interés");
      expect(system).toContain("seguimiento"); // objetivo fallback (goal original)
    });

    it("playbook de la marca inactivo/borrado (findFirst → null): null, sin caer al global", async () => {
      withBrand({ ...YAX, playbookId: "pb-yax" });
      getBotConfig.mockResolvedValue({ ...BASE_CONFIG, activePlaybookId: "pb-global" });
      botPlaybookFindFirst.mockResolvedValue(null);
      findConversationForChannel.mockResolvedValue({ id: "conv1" });
      convPlaybookStateFindUnique.mockResolvedValue({
        conversationId: "conv-y", playbookId: "pb-yax", completedTaskKeys: [],
      });

      const result = await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

      expect(result).toEqual({});
      expect(botPlaybookFindFirst).toHaveBeenCalledTimes(1); // solo el de la marca
      expect(botPlaybookFindFirst.mock.calls[0][0].where.id).toBe("pb-yax");
      expect(findConversationForChannel).not.toHaveBeenCalled();
      const system = askClaude.mock.calls[0][0].system as string;
      expect(system).not.toContain("confirmar zona de interés");
      expect(system).toContain("seguimiento");
    });

    it("error cargando el playbook de la marca: null, sin caer al global, y el borrador se genera igual", async () => {
      withBrand({ ...YAX, playbookId: "pb-yax" });
      getBotConfig.mockResolvedValue({ ...BASE_CONFIG, activePlaybookId: "pb-global" });
      botPlaybookFindFirst.mockRejectedValue(new Error("boom"));

      const result = await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

      expect(result).toEqual({});
      expect(botPlaybookFindFirst).toHaveBeenCalledTimes(1);
      expect(activityCreate).toHaveBeenCalledTimes(1);
      expect(askClaude.mock.calls[0][0].system).toContain("seguimiento");
    });

    it("sin marca: el playbook global sigue funcionando como siempre", async () => {
      getBotConfig.mockResolvedValue({ ...BASE_CONFIG, activePlaybookId: "pb-global" });
      findConversationForChannel.mockResolvedValue({ id: "conv1" });
      convPlaybookStateFindUnique.mockResolvedValue({ conversationId: "conv1", completedTaskKeys: ["a"] });
      botPlaybookFindFirst.mockResolvedValue({ id: "pb-global", tasks: [TASK_A, TASK_B] });

      await runAiAction("AI_DRAFT", CONTACT, { kind: "seguimiento" });

      expect(botPlaybookFindFirst).toHaveBeenCalledTimes(1);
      expect(botPlaybookFindFirst.mock.calls[0][0].where.id).toBe("pb-global");
      expect(askClaude.mock.calls[0][0].system).toContain("confirmar presupuesto");
    });
  });
});

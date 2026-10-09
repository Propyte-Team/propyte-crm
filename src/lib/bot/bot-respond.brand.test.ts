import { describe, it, expect, vi, beforeEach } from "vitest";

// El agente responde por marca (2026-10-09, spec marcas-agente §3.2): una conversación que
// entra por una cuenta con marca NO predeterminada contesta SOLO como esa marca (historial
// de la conversación, catálogo por developmentIds, sin agentes por segmento, tono, canales,
// interruptor, playbook y responsable de marketing propios). Cuenta sin marca = camino de
// siempre. Scaffolding de mocks tomado de bot-respond.marketing.test.ts: aquí tampoco se
// mockea marketing-routing, se ejercita el resolvedor real contra un db falso.

const sendChannelMessage = vi.fn();
vi.mock("@/lib/messaging/dispatcher", () => ({
  sendChannelMessage: (...a: unknown[]) => sendChannelMessage(...a),
}));

const contactFindUnique = vi.fn();
const convFindFirst = vi.fn();
const convFindUnique = vi.fn();
const convUpdate = vi.fn();
const msgFindMany = vi.fn();
const userFindFirst = vi.fn();
const configFindUnique = vi.fn();
const notificationCreate = vi.fn();
const botAgentCountMock = vi.fn();
const botPlaybookFindFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    conversation: {
      findFirst: (...a: unknown[]) => convFindFirst(...a),
      findUnique: (...a: unknown[]) => convFindUnique(...a),
      update: (...a: unknown[]) => convUpdate(...a),
    },
    message: {
      findMany: (...a: unknown[]) => msgFindMany(...a),
      findFirst: vi.fn(async () => null), // guard anti-burst: sin mensajes nuevos
    },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    systemConfig: { findUnique: (...a: unknown[]) => configFindUnique(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
    botAgentProfile: { count: (...a: unknown[]) => botAgentCountMock(...a) },
    botPlaybook: { findFirst: (...a: unknown[]) => botPlaybookFindFirstMock(...a) },
  },
}));

const askClaude = vi.fn();
const buildSystemPromptMock = vi.fn();
vi.mock("./claude", () => ({
  askClaude: (...a: unknown[]) => askClaude(...a),
  buildSystemPrompt: (...a: unknown[]) => buildSystemPromptMock(...a),
  ESCALATE_TOKEN: "[ESCALAR]",
}));

// Mutable: el caso del playbook cambia activePlaybookId (lo lee getBotConfig en cada llamada).
const botConfig = {
  botEnabled: true,
  tonePreset: "PROFESIONAL_CALIDO",
  autonomyLevel: "L2",
  model: "claude-sonnet-5",
  openerStyle: "WARM_NAME",
  maxLines: 4,
  dataGateStrict: true,
  escalationTriggers: [],
  enabledChannels: ["WHATSAPP"],
  activePlaybookId: null as string | null,
  classifyContacts: false,
};
vi.mock("./config", () => ({ getBotConfig: async () => ({ ...botConfig }) }));
vi.mock("./brand-linter", () => ({ lintBrandVoice: () => ({ ok: true, violations: [] }) }));

const findDevsMock = vi.fn();
vi.mock("./hub-catalog", () => ({
  findMatchingDevelopments: (...a: unknown[]) => findDevsMock(...a),
  catalogBrief: () => "",
}));

const resolveBrandMock = vi.fn();
vi.mock("@/lib/brands/resolve", () => ({
  resolveBrandForConnector: (...a: unknown[]) => resolveBrandMock(...a),
  isBrandScoped: (r: { kind: string }) => r.kind === "brand",
}));

vi.mock("./classify", () => ({ maybeClassifyContact: vi.fn(async () => null) }));
const runPlaybookStepMock = vi.fn();
vi.mock("./playbook/run", () => ({ runPlaybookStep: (...a: unknown[]) => runPlaybookStepMock(...a) }));

import { botRespond } from "./bot-respond";
import { ESCALATE_MARKETING_TOKEN } from "./marketing-routing";

const LUIS = "23361b42-f80c-42ce-ba8f-3a232b9f088c";

const YAX = {
  id: "b-yax", name: "Yaxnáh Caucel", isDefault: false, persona: "Eres el asistente de Yaxnáh.", knowledge: "K",
  developmentIds: ["dev-yax"], defaultPlaza: "MERIDA", enabledChannels: ["WHATSAPP", "INSTAGRAM"],
  tonePreset: "CALIDO_CERCANO_MX", playbookId: null, marketingOwnerUserId: "u-mkt-yax", botEnabled: true, deletedAt: null,
};
const CONV_YAX = { id: "conv-y", status: "BOT", botEnabled: true, connectorId: "c-yax" };

const CONTACT = {
  id: "c1", firstName: "Ana", lastName: "García", phone: "+5212345",
  doNotContact: false, whatsappOptOut: false, assignedToId: "u-owner",
  budgetMin: null, budgetMax: null, preferredZone: null, preferredLanguage: "es",
  contactType: "COMPRADOR", custom: null,
};

/** system_config falso: { clave: valor } */
function setConfig(rows: Record<string, unknown>) {
  configFindUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    where.key in rows ? { key: where.key, value: rows[where.key] } : null,
  );
}
/** users activos falsos: findFirst({ where: { id } }) → existe solo si el id está en la lista */
function setActiveUsers(ids: string[]) {
  userFindFirst.mockImplementation(async ({ where }: { where: { id?: string; role?: string } }) => {
    if (where.id) return ids.includes(where.id) ? { id: where.id } : null;
    return { id: "admin-fallback" }; // el findFirst sin id es el de ownerId (primer ADMIN)
  });
}
/** Cuenta con marca (no predeterminada) resuelta por el resolvedor mockeado. */
function withBrand(brand: Record<string, unknown> = YAX) {
  resolveBrandMock.mockResolvedValue({ kind: "brand", brand });
}
/** Conversaciones HUMAN creadas por escalateToHuman (excluye el update de lastMessageAt). */
function escalations() {
  return convUpdate.mock.calls.filter((c) => c[0].data.status === "HUMAN");
}

beforeEach(() => {
  vi.resetAllMocks();
  botConfig.activePlaybookId = null;
  contactFindUnique.mockResolvedValue(CONTACT);
  convFindFirst.mockResolvedValue(CONV_YAX);
  convFindUnique.mockResolvedValue({ id: "conv-y", contact: CONTACT });
  convUpdate.mockResolvedValue({});
  msgFindMany.mockResolvedValue([
    { direction: "INBOUND", body: "Hola, me interesa un departamento", createdAt: new Date() },
  ]);
  sendChannelMessage.mockResolvedValue({ id: "m1" });
  notificationCreate.mockResolvedValue({});
  botAgentCountMock.mockResolvedValue(0);
  botPlaybookFindFirstMock.mockResolvedValue(null);
  findDevsMock.mockResolvedValue({ data: [], error: null });
  buildSystemPromptMock.mockReturnValue("SYSTEM");
  askClaude.mockResolvedValue("Hola");
  setConfig({ admin_owner_user_id: LUIS });
  setActiveUsers([LUIS]);
  resolveBrandMock.mockResolvedValue({ kind: "default" });
});

describe("botRespond — cuenta con marca", () => {
  it("1. el historial es solo de la conversación, no de todo el contacto", async () => {
    convFindFirst.mockResolvedValue(CONV_YAX);
    withBrand();
    askClaude.mockResolvedValue("Hola");

    await botRespond("c1", { connectorId: "c-yax" });

    expect(msgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: "conv-y", internalNote: false } }),
    );
  });

  it("2. sin agentes por segmento ni clasificador", async () => {
    withBrand();

    await botRespond("c1", { connectorId: "c-yax" });

    expect(botAgentCountMock).not.toHaveBeenCalled();
  });

  it("3. el catálogo sale de developmentIds de la marca, sin presupuesto ni zona del contacto", async () => {
    const conPerfil = { ...CONTACT, budgetMax: 9e6, preferredZone: "Tulum" };
    contactFindUnique.mockResolvedValue(conPerfil);
    convFindUnique.mockResolvedValue({ id: "conv-y", contact: conPerfil });
    withBrand();

    await botRespond("c1", { connectorId: "c-yax" });

    expect(findDevsMock).toHaveBeenCalledWith({ developmentIds: ["dev-yax"], limit: 10 });
  });

  it("4. el prompt lleva la marca y el tono de la marca", async () => {
    withBrand();

    await botRespond("c1", { connectorId: "c-yax" });

    const args = buildSystemPromptMock.mock.calls[0][0];
    expect(args.brand).toEqual({ name: "Yaxnáh Caucel", persona: YAX.persona, knowledge: "K" });
    expect(args.config.tonePreset).toBe("CALIDO_CERCANO_MX");
  });

  it("5a. canales por marca: INSTAGRAM habilitado solo para la marca → envía", async () => {
    withBrand(); // la marca habilita WHATSAPP e INSTAGRAM; el global solo WHATSAPP

    await botRespond("c1", { channel: "INSTAGRAM", connectorId: "c-yax" });

    expect(sendChannelMessage).toHaveBeenCalledTimes(1);
    expect(sendChannelMessage.mock.calls[0][0]).toBe("INSTAGRAM");
  });

  it("5b. con la cuenta sin marca, el mismo canal NO envía (el global solo tiene WHATSAPP)", async () => {
    resolveBrandMock.mockResolvedValue({ kind: "default" });

    const result = await botRespond("c1", { channel: "INSTAGRAM", connectorId: "c-yax" });

    expect(result).toBe(false);
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("6. enabledChannels inválido en la marca → hereda el global, sin lanzar", async () => {
    withBrand({ ...YAX, enabledChannels: { roto: true } });

    await expect(botRespond("c1", { channel: "WHATSAPP", connectorId: "c-yax" })).resolves.toBe(true);
    expect(sendChannelMessage).toHaveBeenCalledTimes(1);

    sendChannelMessage.mockClear();
    await expect(botRespond("c1", { channel: "INSTAGRAM", connectorId: "c-yax" })).resolves.toBe(false);
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("7. marca apagada → no envía y escala UNA vez con el motivo", async () => {
    withBrand({ ...YAX, botEnabled: false });
    askClaude.mockResolvedValue("Resumen para el asesor"); // único askClaude: el resumen de escalateToHuman

    const result = await botRespond("c1", { connectorId: "c-yax" });

    expect(result).toBe(false);
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(convUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "conv-y" }, data: expect.objectContaining({ status: "HUMAN" }) }),
    );
    expect(escalations()).toHaveLength(1);
    // el askClaude del resumen recibió el motivo; no se generó ninguna respuesta al cliente
    expect(askClaude).toHaveBeenCalledTimes(1);
    const resumenMsg = askClaude.mock.calls[0][0].messages[0].content as string;
    expect(resumenMsg).toContain("Agente de la marca «Yaxnáh Caucel» apagado");
  });

  it("8. marca no disponible → no envía, no escala, no llama a Claude", async () => {
    resolveBrandMock.mockResolvedValue({ kind: "unavailable", brandId: "b-x" });

    const result = await botRespond("c1", { connectorId: "c-yax" });

    expect(result).toBe(false);
    expect(askClaude).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(convUpdate).not.toHaveBeenCalled();
  });

  it("9. [ESCALAR_MARKETING] con marca → el hilo va al responsable de marketing de la marca si está activo", async () => {
    withBrand();
    setActiveUsers(["u-mkt-yax", LUIS]);
    askClaude
      .mockResolvedValueOnce(`Con gusto comparto tu mensaje. ${ESCALATE_MARKETING_TOKEN}`)
      .mockResolvedValueOnce("Resumen"); // askClaude del resumen en escalateToHuman

    await botRespond("c1", { connectorId: "c-yax" });

    expect(convUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "HUMAN", controlledById: "u-mkt-yax" }) }),
    );
    expect(notificationCreate.mock.calls[0][0].data.userId).toBe("u-mkt-yax");
  });

  it("10. playbook de la marca: el activo de la marca manda sobre el global", async () => {
    botConfig.activePlaybookId = "pb-global";
    withBrand({ ...YAX, playbookId: "pb-yax" });
    botPlaybookFindFirstMock.mockResolvedValue({ id: "pb-yax", tasks: [{ id: "t1", order: 1 }] });
    runPlaybookStepMock.mockResolvedValue({ objective: "OBJ" });

    await botRespond("c1", { connectorId: "c-yax" });

    expect(botPlaybookFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "pb-yax" }) }),
    );
    expect(runPlaybookStepMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ playbook: expect.objectContaining({ id: "pb-yax" }) }),
    );
  });

  it("10b. marca sin playbook propio NO hereda el playbook global", async () => {
    botConfig.activePlaybookId = "pb-global";
    withBrand({ ...YAX, playbookId: null });

    await botRespond("c1", { connectorId: "c-yax" });

    expect(botPlaybookFindFirstMock).not.toHaveBeenCalled();
    expect(runPlaybookStepMock).not.toHaveBeenCalled();
  });
});

describe("botRespond — cuenta sin marca (camino de siempre)", () => {
  it("11. todo igual que antes: agentes, historial del contacto y prompt sin `brand`", async () => {
    resolveBrandMock.mockResolvedValue({ kind: "default" });

    await botRespond("c1", { connectorId: "c-plain" });

    expect(botAgentCountMock).toHaveBeenCalled();
    expect(msgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contactId: "c1", internalNote: false } }),
    );
    const args = buildSystemPromptMock.mock.calls[0][0];
    expect(args.brand).toBeUndefined();
    expect(args).not.toHaveProperty("brand"); // ausente, no `brand: undefined`
  });
});

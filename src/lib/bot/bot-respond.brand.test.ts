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
const convCreate = vi.fn();
const contactBrandFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    conversation: {
      findFirst: (...a: unknown[]) => convFindFirst(...a),
      findUnique: (...a: unknown[]) => convFindUnique(...a),
      update: (...a: unknown[]) => convUpdate(...a),
      create: (...a: unknown[]) => convCreate(...a),
    },
    contactBrand: { findFirst: (...a: unknown[]) => contactBrandFindFirst(...a) },
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
  convCreate.mockImplementation(async ({ data }: { data: { connectorId: string | null } }) => ({
    id: "conv-nueva", status: "BOT", botEnabled: true, connectorId: data.connectorId,
  }));
  contactBrandFindFirst.mockResolvedValue(null);
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

  it("10a. playbook de la marca: se le pide a runPlaybookStep ignorar el estado de OTRO playbook", async () => {
    withBrand({ ...YAX, playbookId: "pb-yax" });
    botPlaybookFindFirstMock.mockResolvedValue({ id: "pb-yax", tasks: [{ id: "t1", order: 1 }] });
    runPlaybookStepMock.mockResolvedValue({ objective: "OBJ" });

    await botRespond("c1", { connectorId: "c-yax" });

    expect(runPlaybookStepMock.mock.calls[0][1]).toMatchObject({ ignoreForeignState: true });
  });

  it("10a-bis. sin marca, runPlaybookStep recibe los argumentos de siempre (sin la bandera)", async () => {
    botConfig.activePlaybookId = "pb-global";
    convFindFirst.mockResolvedValue({ id: "conv1", status: "BOT", botEnabled: true, connectorId: null });
    botPlaybookFindFirstMock.mockResolvedValue({ id: "pb-global", tasks: [{ id: "t1", order: 1 }] });
    runPlaybookStepMock.mockResolvedValue({ objective: "OBJ" });

    await botRespond("c1");

    expect(runPlaybookStepMock).toHaveBeenCalledTimes(1);
    expect(runPlaybookStepMock.mock.calls[0][1]).not.toHaveProperty("ignoreForeignState");
  });

  it("10b. marca sin playbook propio NO hereda el playbook global", async () => {
    botConfig.activePlaybookId = "pb-global";
    withBrand({ ...YAX, playbookId: null });

    await botRespond("c1", { connectorId: "c-yax" });

    expect(botPlaybookFindFirstMock).not.toHaveBeenCalled();
    expect(runPlaybookStepMock).not.toHaveBeenCalled();
  });
});

describe("botRespond — la conversación y la marca salen de la misma cuenta", () => {
  const CONV_PROP = { id: "conv-p", status: "BOT", botEnabled: true, connectorId: "c-prop" };
  /** Búsqueda de conversación falsa: con `connectorId` en el where → solo el hilo de esa cuenta
   *  (si existe en `porCuenta`; el hilo sin cuenta va con la clave "null"); sin él
   *  (findConversationForChannel) → el hilo más reciente. */
  function setThreads(porCuenta: Record<string, unknown>, masReciente: unknown) {
    convFindFirst.mockImplementation(async ({ where }: { where: { connectorId?: string | null } }) =>
      where.connectorId !== undefined ? (porCuenta[String(where.connectorId)] ?? null) : masReciente,
    );
  }
  /** c-yax → marca Yaxnáh; cualquier otra cuenta → predeterminada. */
  function brandOnlyForYax() {
    resolveBrandMock.mockImplementation(async (id: string | null) =>
      id === "c-yax" ? { kind: "brand", brand: YAX } : { kind: "default" },
    );
  }

  it("12. connectorId de la marca pero el hilo más reciente es de otra cuenta → no contesta (cierra en falso)", async () => {
    brandOnlyForYax();
    // por cuenta c-yax: no hay hilo; el hilo más reciente del contacto (cualquier cuenta) es el de Propyte.
    setThreads({}, CONV_PROP);

    const result = await botRespond("c1", { connectorId: "c-yax" });

    expect(result).toBe(false);
    expect(askClaude).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(convUpdate).not.toHaveBeenCalled();
  });

  it("12b. y al revés: cuenta predeterminada pero el hilo encontrado es de una marca → no contesta", async () => {
    brandOnlyForYax();
    setThreads({}, CONV_YAX);

    const result = await botRespond("c1", { connectorId: "c-prop" });

    expect(result).toBe(false);
    expect(askClaude).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(convUpdate).not.toHaveBeenCalled();
  });

  it("12c. hilos de otra cuenta que tampoco se pueden resolver (marca no disponible) → no contesta", async () => {
    resolveBrandMock.mockImplementation(async (id: string | null) =>
      id === "c-roto" ? { kind: "unavailable", brandId: "b-x" } : { kind: "default" },
    );
    setThreads({}, { ...CONV_PROP, connectorId: "c-roto" });

    const result = await botRespond("c1", { connectorId: "c-prop" });

    expect(result).toBe(false);
    expect(askClaude).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("13. con connectorId se busca primero el hilo de ESA cuenta y contesta como la marca", async () => {
    brandOnlyForYax();
    // el hilo más reciente del contacto es el de Propyte, pero existe uno de c-yax: gana ese
    setThreads({ "c-yax": CONV_YAX }, CONV_PROP);

    const result = await botRespond("c1", { connectorId: "c-yax" });

    expect(result).toBe(true);
    // la primera búsqueda de conversación es por (contacto, canal, cuenta)
    expect(convFindFirst.mock.calls[0][0]).toEqual({
      where: { contactId: "c1", channel: "WHATSAPP", connectorId: "c-yax" },
    });
    expect(buildSystemPromptMock.mock.calls[0][0].brand).toEqual({
      name: "Yaxnáh Caucel", persona: YAX.persona, knowledge: "K",
    });
    // y sale por la cuenta de la marca
    expect(sendChannelMessage.mock.calls[0][4]).toEqual({ bot: true, connectorId: "c-yax" });
  });

  it("13b. sin hilo de esa cuenta pero el más reciente también es de predeterminadas → sigue como siempre", async () => {
    // cuenta predeterminada c-a sin hilo propio; el hilo más reciente es de otra predeterminada c-prop
    setThreads({}, CONV_PROP);

    const result = await botRespond("c1", { connectorId: "c-a" });

    expect(result).toBe(true);
    expect(buildSystemPromptMock.mock.calls[0][0]).not.toHaveProperty("brand");
  });

  // Hallazgo C2(b) de la revisión final: `connectorId: null` explícito es "el cliente escribió al
  // número global" (lo sabe el webhook); `undefined` es "no sé, infiérelo del hilo más reciente".
  it("16. connectorId null EXPLÍCITO (número global) NO infiere la cuenta del hilo de una marca", async () => {
    brandOnlyForYax();
    // el hilo más reciente del contacto es el de Yaxnáh
    setThreads({}, CONV_YAX);

    const result = await botRespond("c1", { connectorId: null });

    expect(result).toBe(false);
    // la marca que se resolvió primero es la del número global (null), no la del hilo de Yaxnáh
    expect(resolveBrandMock.mock.calls[0][0]).toBeNull();
    expect(askClaude).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("16b. connectorId null explícito con hilo sin cuenta → contesta como siempre (sin marca)", async () => {
    brandOnlyForYax();
    setThreads({}, { id: "conv-g", status: "BOT", botEnabled: true, connectorId: null });

    const result = await botRespond("c1", { connectorId: null });

    expect(result).toBe(true);
    expect(buildSystemPromptMock.mock.calls[0][0]).not.toHaveProperty("brand");
    expect(sendChannelMessage.mock.calls[0][4]).toEqual({ bot: true, connectorId: null });
  });

  it("16d. connectorId null explícito: se busca primero el hilo SIN cuenta aunque el más reciente sea de una marca", async () => {
    brandOnlyForYax();
    const CONV_GLOBAL = { id: "conv-g", status: "BOT", botEnabled: true, connectorId: null };
    // el hilo más reciente es el de Yaxnáh, pero el mensaje llegó al número global y su hilo existe
    setThreads({ null: CONV_GLOBAL }, CONV_YAX);

    const result = await botRespond("c1", { connectorId: null });

    expect(result).toBe(true);
    // la primera búsqueda de conversación es por (contacto, canal, sin cuenta), como la ingesta
    expect(convFindFirst.mock.calls[0][0]).toEqual({
      where: { contactId: "c1", channel: "WHATSAPP", connectorId: null },
    });
    expect(buildSystemPromptMock.mock.calls[0][0]).not.toHaveProperty("brand");
    expect(sendChannelMessage.mock.calls[0][4]).toEqual({ bot: true, connectorId: null });
  });

  it("16c. connectorId AUSENTE (undefined) sigue infiriendo la cuenta del hilo más reciente (sin cambio)", async () => {
    brandOnlyForYax();
    setThreads({}, CONV_YAX);

    const result = await botRespond("c1");

    expect(result).toBe(true);
    expect(resolveBrandMock.mock.calls[0][0]).toBe("c-yax");
    expect(buildSystemPromptMock.mock.calls[0][0].brand).toEqual({
      name: "Yaxnáh Caucel", persona: YAX.persona, knowledge: "K",
    });
    expect(sendChannelMessage.mock.calls[0][4]).toEqual({ bot: true, connectorId: "c-yax" });
  });
});

describe("botRespond — cuenta sin marca (camino de siempre)", () => {
  it("11. todo igual que antes: agentes, historial del contacto y prompt sin `brand`", async () => {
    resolveBrandMock.mockResolvedValue({ kind: "default" });
    convFindFirst.mockResolvedValue({ ...CONV_YAX, connectorId: "c-plain" });

    await botRespond("c1", { connectorId: "c-plain" });

    expect(botAgentCountMock).toHaveBeenCalled();
    expect(msgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contactId: "c1", internalNote: false } }),
    );
    const args = buildSystemPromptMock.mock.calls[0][0];
    expect(args.brand).toBeUndefined();
    expect(args).not.toHaveProperty("brand"); // ausente, no `brand: undefined`
  });

  it("14. sin connectorId la búsqueda de conversación es exactamente la de siempre y no se consulta nada nuevo", async () => {
    convFindFirst.mockResolvedValue({ id: "conv1", status: "BOT", botEnabled: true, connectorId: null });

    const result = await botRespond("c1");

    expect(result).toBe(true);
    // dos veces findConversationForChannel (cuenta del hilo + hilo), idénticas a hoy
    expect(convFindFirst).toHaveBeenCalledTimes(2);
    for (const call of convFindFirst.mock.calls) {
      expect(call[0]).toEqual({ where: { contactId: "c1", channel: "WHATSAPP" }, orderBy: { lastMessageAt: "desc" } });
    }
    // hilo y cuenta coinciden → no hay segunda resolución de marca
    expect(resolveBrandMock).toHaveBeenCalledTimes(1);
    expect(resolveBrandMock).toHaveBeenCalledWith(null);
  });
});

describe("botRespond — apertura (primer mensaje)", () => {
  const CON_ZONA = { ...CONTACT, preferredZone: "Tulum" };

  it("15. con marca el opener NO inyecta la zona del contacto", async () => {
    contactFindUnique.mockResolvedValue(CON_ZONA);
    convFindUnique.mockResolvedValue({ id: "conv-y", contact: CON_ZONA });
    withBrand();

    await botRespond("c1", { connectorId: "c-yax" });

    const objective = buildSystemPromptMock.mock.calls[0][0].objective as string;
    expect(objective).toContain("Este es el primer mensaje"); // sí hay opener
    expect(objective).not.toContain("Tulum");
  });

  it("15b. sin marca el opener sigue mencionando la zona del contacto (sin cambio)", async () => {
    contactFindUnique.mockResolvedValue(CON_ZONA);
    resolveBrandMock.mockResolvedValue({ kind: "default" });

    await botRespond("c1");

    const objective = buildSystemPromptMock.mock.calls[0][0].objective as string;
    expect(objective).toContain("Tulum");
  });
});

// Hallazgo I3 de la revisión final: AI_REPLY (workflow) llama con createConversation y sin cuenta.
// Un contacto atribuido a una marca no predeterminada que no tiene hilo recibiría un WhatsApp con
// la voz de Propyte desde el número global. Con filas de otra marca y sin cuenta → no se crea nada.
describe("botRespond — createConversation sin cuenta", () => {
  beforeEach(() => {
    convFindFirst.mockResolvedValue(null); // el contacto no tiene ningún hilo de WhatsApp
  });

  /**
   * contact_brands falso que responde según el filtro de marca de la consulta:
   * `isDefault: false` = ¿tiene fila de otra marca?, `isDefault: true` = ¿tiene fila de la predeterminada?
   */
  function setContactBrands({ otra, predeterminada }: { otra: boolean; predeterminada: boolean }) {
    contactBrandFindFirst.mockImplementation(async ({ where }: { where: { brand: { isDefault: boolean } } }) => {
      if (where.brand.isDefault) return predeterminada ? { brandId: "b-prop" } : null;
      return otra ? { brandId: "b-yax" } : null;
    });
  }

  it("17. contacto SOLO de una marca no predeterminada, sin hilo → no crea conversación ni envía, y avisa", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setContactBrands({ otra: true, predeterminada: false });

    const result = await botRespond("c1", { goal: "seguimiento", createConversation: true });

    expect(result).toBe(false);
    expect(contactBrandFindFirst).toHaveBeenCalledWith({
      where: { contactId: "c1", brand: { isDefault: false, deletedAt: null } },
      select: { brandId: true },
    });
    // Revisión final I2 (2026-10-09): además se comprueba que NO tenga la fila de la predeterminada.
    expect(contactBrandFindFirst).toHaveBeenCalledWith({
      where: { contactId: "c1", brand: { isDefault: true } },
      select: { brandId: true },
    });
    expect(convCreate).not.toHaveBeenCalled();
    expect(askClaude).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[bot-respond]"), "c1");
    warn.mockRestore();
  });

  // Revisión final I2 (2026-10-09), spec §2.3: un contacto que ya existía y escribe a otra marca
  // pertenece a AMBAS — attachBrand escribe la fila de la predeterminada justo para eso. Esos
  // contactos SON de Propyte: el AI_REPLY desde el número global es legítimo y no se bloquea.
  it("17g. contacto de otra marca Y de la predeterminada (compartido) → crea la conversación y contesta como hoy", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setContactBrands({ otra: true, predeterminada: true });

    const result = await botRespond("c1", { goal: "seguimiento", createConversation: true });

    expect(result).toBe(true);
    expect(convCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ connectorId: null, status: "BOT" }) }),
    );
    expect(sendChannelMessage).toHaveBeenCalledTimes(1);
    // No es un caso de "contacto de otra marca sin cuenta": no hay aviso.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("17b. sin filas de marca → crea la conversación sin cuenta y contesta como hoy (sin cambio)", async () => {
    const result = await botRespond("c1", { goal: "seguimiento", createConversation: true });

    expect(result).toBe(true);
    expect(convCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ connectorId: null, status: "BOT" }) }),
    );
    expect(buildSystemPromptMock.mock.calls[0][0]).not.toHaveProperty("brand");
    expect(sendChannelMessage).toHaveBeenCalledTimes(1);
    // Sin fila de otra marca no hace falta preguntar por la predeterminada: una sola consulta, como hoy.
    expect(contactBrandFindFirst).toHaveBeenCalledTimes(1);
  });

  it("17c. tabla contact_brands inexistente (P2021) = sin filas → crea como hoy", async () => {
    contactBrandFindFirst.mockRejectedValue({ code: "P2021" });

    const result = await botRespond("c1", { goal: "seguimiento", createConversation: true });

    expect(result).toBe(true);
    expect(convCreate).toHaveBeenCalledTimes(1);
  });

  it("17c2. columna inexistente (P2022) = sin filas → crea como hoy", async () => {
    contactBrandFindFirst.mockRejectedValue({ code: "P2022" });

    const result = await botRespond("c1", { goal: "seguimiento", createConversation: true });

    expect(result).toBe(true);
    expect(convCreate).toHaveBeenCalledTimes(1);
  });

  it("17d. otro error leyendo contact_brands → falla cerrado (no crea ni envía) y lo registra", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    contactBrandFindFirst.mockRejectedValue(new Error("boom"));

    const result = await botRespond("c1", { goal: "seguimiento", createConversation: true });

    expect(result).toBe(false);
    expect(convCreate).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[bot-respond]"), "c1", expect.any(Error));
    error.mockRestore();
  });

  it("17d2. falla la lectura de la fila de la predeterminada (con fila de otra marca) → falla cerrado y lo registra", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    contactBrandFindFirst
      .mockResolvedValueOnce({ brandId: "b-yax" }) // fila de otra marca
      .mockRejectedValueOnce(new Error("boom")); // ¿también de la predeterminada? no se pudo leer

    const result = await botRespond("c1", { goal: "seguimiento", createConversation: true });

    expect(result).toBe(false);
    expect(convCreate).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[bot-respond]"), "c1", expect.any(Error));
    error.mockRestore();
  });

  it("17e. con cuenta resuelta (no null) no se consulta contact_brands (la cuenta ya decide la marca)", async () => {
    convFindFirst.mockResolvedValue({ id: "conv-p", status: "BOT", botEnabled: true, connectorId: "c-prop" });

    const result = await botRespond("c1", { goal: "seguimiento", createConversation: true });

    expect(result).toBe(true);
    expect(contactBrandFindFirst).not.toHaveBeenCalled();
  });

  it("17f. sin createConversation no se consulta contact_brands (webhooks: sin cambio)", async () => {
    convFindFirst.mockResolvedValue({ id: "conv-g", status: "BOT", botEnabled: true, connectorId: null });

    await botRespond("c1", { connectorId: null });

    expect(contactBrandFindFirst).not.toHaveBeenCalled();
  });
});

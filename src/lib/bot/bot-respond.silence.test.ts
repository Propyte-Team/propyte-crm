import { describe, it, expect, vi, beforeEach } from "vitest";

// 2026-10-12: dos WhatsApp al número general se quedaron sin respuesta y sin rastro (ni
// saliente, ni nota, conversación en BOT, canal activo, contacto sin baja). Cada `return false`
// de botRespond que delata algo mal o mal configurado deja ahora una nota «El agente no
// contestó: …»; los silencios normales NO la dejan. Aquí se fija cuál es cuál y el motivo.
// El texto final (prefijo, deduplicado, «nunca lanza») se prueba en send-failure.test.ts.

const sendChannelMessage = vi.fn();
vi.mock("@/lib/messaging/dispatcher", () => ({
  sendChannelMessage: (...a: unknown[]) => sendChannelMessage(...a),
}));

const recordBotSilence = vi.fn();
const recordBotSendFailure = vi.fn();
vi.mock("@/lib/messaging/send-failure", () => ({
  recordBotSilence: (...a: unknown[]) => recordBotSilence(...a),
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
const notificationCreate = vi.fn();
const contactBrandFindFirst = vi.fn();
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
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
    contactBrand: { findFirst: (...a: unknown[]) => contactBrandFindFirst(...a) },
    botAgentProfile: { count: async () => 0 },
  },
}));

const askClaude = vi.fn();
vi.mock("./claude", () => ({
  askClaude: (...a: unknown[]) => askClaude(...a),
  buildSystemPrompt: () => "SYSTEM",
  ESCALATE_TOKEN: "[ESCALAR]",
}));

// Mutable: cada caso ajusta el interruptor maestro o los canales.
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
  classifyContacts: false,
};
vi.mock("./config", () => ({ getBotConfig: async () => ({ ...botConfig }) }));
vi.mock("./brand-linter", () => ({ lintBrandVoice: () => ({ ok: true, violations: [] }) }));
vi.mock("./hub-catalog", () => ({
  findMatchingDevelopments: async () => ({ data: [], error: null }),
  catalogBrief: () => "",
}));

const resolveBrand = vi.fn();
vi.mock("@/lib/brands/resolve", () => ({
  resolveBrandForConnector: (...a: unknown[]) => resolveBrand(...a),
  isBrandScoped: (r: { kind: string }) => r.kind === "brand",
}));

import { botRespond, describeAiSilence } from "./bot-respond";

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
  contactType: "COMPRADOR",
};

const CONV = { id: "conv1", status: "BOT", botEnabled: true, connectorId: null };

const YAX = {
  id: "b-yax", name: "Yaxnáh Caucel", isDefault: false, persona: null, knowledge: null,
  developmentIds: [], enabledChannels: ["WHATSAPP"], tonePreset: null, playbookId: null,
  marketingOwnerUserId: null, botEnabled: true, deletedAt: null,
};

/** El único motivo que se registró (y que se registró exactamente una vez). */
function onlyReason(): string {
  expect(recordBotSilence).toHaveBeenCalledTimes(1);
  return recordBotSilence.mock.calls[0][0].reason as string;
}

beforeEach(() => {
  vi.resetAllMocks();
  botConfig.botEnabled = true;
  botConfig.enabledChannels = ["WHATSAPP", "INSTAGRAM", "MESSENGER"];
  contactFindUnique.mockResolvedValue(CONTACT);
  convFindFirst.mockResolvedValue(CONV);
  convFindUnique.mockResolvedValue({ ...CONV, contact: CONTACT });
  convUpdate.mockResolvedValue({});
  msgFindMany.mockResolvedValue([{ direction: "INBOUND", body: "Hola", createdAt: new Date() }]);
  msgFindFirst.mockResolvedValue(null); // sin mensajes nuevos durante la generación
  userFindFirst.mockResolvedValue({ id: "admin-1" });
  notificationCreate.mockResolvedValue({});
  contactBrandFindFirst.mockResolvedValue(null);
  sendChannelMessage.mockResolvedValue({ id: "m1" });
  recordBotSilence.mockResolvedValue(undefined);
  recordBotSendFailure.mockResolvedValue(undefined);
  resolveBrand.mockResolvedValue({ kind: "default" });
  askClaude.mockResolvedValue("Hola Ana, ¿qué zona te interesa?");
});

describe("botRespond — silencios que SÍ dejan nota", () => {
  it("marca no disponible (borrada): nota en el hilo con el id de la marca", async () => {
    resolveBrand.mockResolvedValue({ kind: "unavailable", brandId: "b-borrada" });

    await expect(botRespond("c1", { connectorId: "c-yax" })).resolves.toBe(false);

    expect(recordBotSilence).toHaveBeenCalledWith({
      contactId: "c1",
      conversationId: "conv1",
      channel: "WHATSAPP",
      reason: expect.stringContaining("asignada a una marca que fue borrada o no se pudo leer (marca b-borrada)"),
    });
    expect(askClaude).not.toHaveBeenCalled();
  });

  it("marca no disponible porque no se pudo leer la cuenta: lo dice así", async () => {
    resolveBrand.mockResolvedValue({ kind: "unavailable", brandId: "?" });

    await botRespond("c1", { connectorId: "c-yax" });

    expect(onlyReason()).toContain("no se pudo leer la cuenta por la que llegó el mensaje");
  });

  it("silencio antes de resolver el hilo: la búsqueda es solo lectura (nunca crea conversación)", async () => {
    resolveBrand.mockResolvedValue({ kind: "unavailable", brandId: "b-x" });

    await botRespond("c1", { connectorId: "c-yax", createConversation: true });

    expect(convCreate).not.toHaveBeenCalled();
    expect(recordBotSilence).toHaveBeenCalledTimes(1);
  });

  it("silencio antes de resolver el hilo pero el hilo lo controla un humano: sin nota (solo el aviso)", async () => {
    resolveBrand.mockResolvedValue({ kind: "unavailable", brandId: "b-x" });
    convFindFirst.mockResolvedValue({ ...CONV, status: "HUMAN" });

    await botRespond("c1", { connectorId: "c-yax" });

    // conversationId null = recordBotSilence solo deja el console.warn
    expect(recordBotSilence).toHaveBeenCalledWith(expect.objectContaining({ conversationId: null }));
  });

  it("silencio antes de resolver el hilo y sin ningún hilo: sin nota (solo el aviso)", async () => {
    resolveBrand.mockResolvedValue({ kind: "unavailable", brandId: "b-x" });
    convFindFirst.mockResolvedValue(null);

    await botRespond("c1", { connectorId: "c-yax" });

    expect(recordBotSilence).toHaveBeenCalledWith(expect.objectContaining({ conversationId: null }));
  });

  it("canal apagado en la configuración general: dice qué canal y cuáles están activos", async () => {
    botConfig.enabledChannels = ["WHATSAPP"];

    await expect(botRespond("c1", { channel: "INSTAGRAM" })).resolves.toBe(false);

    expect(onlyReason()).toBe(
      "el canal Instagram no está activado en la configuración general del agente (canales activos: WhatsApp).",
    );
    expect(recordBotSilence.mock.calls[0][0]).toMatchObject({ conversationId: "conv1", channel: "INSTAGRAM" });
  });

  it("ningún canal activo en la configuración general: «ninguno»", async () => {
    botConfig.enabledChannels = [];

    await botRespond("c1");

    expect(onlyReason()).toContain("el canal WhatsApp no está activado en la configuración general del agente (canales activos: ninguno)");
  });

  it("canal apagado para la marca: dice qué marca y sus canales", async () => {
    resolveBrand.mockResolvedValue({ kind: "brand", brand: YAX });
    convFindFirst.mockResolvedValue({ ...CONV, connectorId: "c-yax" });

    await expect(botRespond("c1", { channel: "MESSENGER", connectorId: "c-yax" })).resolves.toBe(false);

    expect(onlyReason()).toBe(
      "el canal Messenger no está activado para la marca «Yaxnáh Caucel» (canales de la marca: WhatsApp).",
    );
  });

  it("cinturón: el hilo es de otra cuenta y hay marca de por medio → nota con las dos cuentas", async () => {
    resolveBrand.mockImplementation(async (id: string | null) =>
      id === "c-yax" ? { kind: "brand", brand: YAX } : { kind: "default" },
    );
    // no hay hilo de c-yax; el más reciente del contacto es el de otra cuenta
    convFindFirst.mockImplementation(async ({ where }: { where: { connectorId?: string | null } }) =>
      where.connectorId !== undefined ? null : { ...CONV, connectorId: "c-otra" },
    );

    await expect(botRespond("c1", { connectorId: "c-yax" })).resolves.toBe(false);

    expect(onlyReason()).toBe(
      "esta conversación es de la cuenta c-otra y el mensaje llegó por la cuenta c-yax (marca «Yaxnáh Caucel»); " +
        "con una marca de por medio no se contesta por la cuenta de otra.",
    );
    expect(askClaude).not.toHaveBeenCalled();
  });

  it("cinturón con el número general: lo nombra así", async () => {
    resolveBrand.mockImplementation(async (id: string | null) =>
      id === "c-yax" ? { kind: "brand", brand: YAX } : { kind: "default" },
    );
    convFindFirst.mockImplementation(async ({ where }: { where: { connectorId?: string | null } }) =>
      where.connectorId !== undefined ? null : { ...CONV, connectorId: "c-yax" },
    );

    await botRespond("c1", { connectorId: null });

    expect(onlyReason()).toContain("esta conversación es de la cuenta c-yax (marca «Yaxnáh Caucel») y el mensaje llegó por el número general");
  });

  it("sin llave de la API: la nota lo dice (y no la llave, que no existe)", async () => {
    askClaude.mockImplementation(async (_opts: unknown, diag: { sinRespuesta?: unknown }) => {
      diag.sinRespuesta = { motivo: "sin_api_key" };
      return null;
    });

    await expect(botRespond("c1")).resolves.toBe(false);

    expect(onlyReason()).toBe(
      "la IA no devolvió respuesta: falta la llave de la API de Claude (ANTHROPIC_API_KEY) en el servidor.",
    );
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("la API contestó sin texto: la nota trae el stop_reason", async () => {
    askClaude.mockImplementation(async (_opts: unknown, diag: { sinRespuesta?: unknown }) => {
      diag.sinRespuesta = { motivo: "respuesta_vacia", stopReason: "refusal" };
      return null;
    });

    await botRespond("c1");

    expect(onlyReason()).toBe("la IA no devolvió respuesta: la API de Claude contestó sin texto (stop_reason: refusal).");
  });

  it("error de la API: nota con status y detalle, y el error se relanza igual que siempre", async () => {
    const err = new Error("Claude API 529: {\"type\":\"error\"}");
    askClaude.mockImplementation(async (_opts: unknown, diag: { sinRespuesta?: unknown }) => {
      diag.sinRespuesta = { motivo: "error_api", status: 529, detalle: "overloaded_error: Overloaded" };
      throw err;
    });

    await expect(botRespond("c1")).rejects.toBe(err);

    expect(onlyReason()).toBe(
      "la IA no devolvió respuesta: la API de Claude respondió con error HTTP 529 (overloaded_error: Overloaded).",
    );
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("la llamada a la API no se completó (tiempo agotado): nota sin status", async () => {
    askClaude.mockImplementation(async (_opts: unknown, diag: { sinRespuesta?: unknown }) => {
      diag.sinRespuesta = { motivo: "error_api", status: null, detalle: "sin respuesta en 10 s" };
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });

    await expect(botRespond("c1")).rejects.toThrow("aborted");

    expect(onlyReason()).toBe("la IA no devolvió respuesta: la llamada a la API de Claude no se completó (sin respuesta en 10 s).");
  });

  it("askClaude sin diagnóstico (null a secas): la nota igual se deja, genérica", async () => {
    askClaude.mockResolvedValue(null);

    await expect(botRespond("c1")).resolves.toBe(false);

    expect(onlyReason()).toBe("la IA no devolvió respuesta.");
  });

  it("respuesta con SOLO el token de escalamiento: nota de respuesta vacía y escala como siempre", async () => {
    askClaude.mockResolvedValueOnce("[ESCALAR]").mockResolvedValueOnce("Resumen");

    await expect(botRespond("c1")).resolves.toBe(true);

    expect(onlyReason()).toBe(
      "la respuesta de la IA quedó vacía al quitarle las marcas internas ([ESCALAR] / [ESCALAR_MARKETING]); " +
        "la conversación pasa a un humano.",
    );
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(convUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "HUMAN" }) }));
  });

  it("respuesta en blanco sin token: nota y `false` (antes devolvía `true` sin haber enviado nada)", async () => {
    askClaude.mockResolvedValue("   ");

    await expect(botRespond("c1")).resolves.toBe(false);

    expect(onlyReason()).toBe(
      "la respuesta de la IA quedó vacía al quitarle las marcas internas ([ESCALAR] / [ESCALAR_MARKETING]).",
    );
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(convUpdate).not.toHaveBeenCalled();
  });

  it("sin asesor ni ADMIN activo para firmar el envío: nota", async () => {
    contactFindUnique.mockResolvedValue({ ...CONTACT, assignedToId: null });
    userFindFirst.mockResolvedValue(null);

    await expect(botRespond("c1")).resolves.toBe(false);

    expect(onlyReason()).toBe(
      "no hay a nombre de quién enviar la respuesta: el contacto no tiene asesor asignado y no hay ningún usuario ADMIN activo.",
    );
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });
});

describe("botRespond — silencios normales: SIN nota", () => {
  it("interruptor maestro apagado", async () => {
    botConfig.botEnabled = false;
    await expect(botRespond("c1")).resolves.toBe(false);
    expect(recordBotSilence).not.toHaveBeenCalled();
    expect(contactFindUnique).not.toHaveBeenCalled();
  });

  it("contacto doNotContact", async () => {
    contactFindUnique.mockResolvedValue({ ...CONTACT, doNotContact: true });
    await expect(botRespond("c1")).resolves.toBe(false);
    expect(recordBotSilence).not.toHaveBeenCalled();
  });

  it("contacto dado de baja de WhatsApp (whatsappOptOut)", async () => {
    contactFindUnique.mockResolvedValue({ ...CONTACT, whatsappOptOut: true });
    await expect(botRespond("c1", { channel: "WHATSAPP" })).resolves.toBe(false);
    expect(recordBotSilence).not.toHaveBeenCalled();
  });

  it("sin conversación", async () => {
    convFindFirst.mockResolvedValue(null);
    await expect(botRespond("c1")).resolves.toBe(false);
    expect(recordBotSilence).not.toHaveBeenCalled();
  });

  it("conversación en control humano", async () => {
    convFindFirst.mockResolvedValue({ ...CONV, status: "HUMAN" });
    await expect(botRespond("c1")).resolves.toBe(false);
    expect(recordBotSilence).not.toHaveBeenCalled();
  });

  it("conversación con el bot apagado (botEnabled false)", async () => {
    convFindFirst.mockResolvedValue({ ...CONV, botEnabled: false });
    await expect(botRespond("c1")).resolves.toBe(false);
    expect(recordBotSilence).not.toHaveBeenCalled();
  });

  it("guard anti-ráfaga: llegó un mensaje más nuevo (lo contesta otro disparo)", async () => {
    msgFindFirst.mockResolvedValue({ id: "m-nuevo" });
    await expect(botRespond("c1")).resolves.toBe(false);
    expect(recordBotSilence).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("agente de la marca apagado: escala (ese ya es su rastro)", async () => {
    resolveBrand.mockResolvedValue({ kind: "brand", brand: { ...YAX, botEnabled: false } });
    convFindFirst.mockResolvedValue({ ...CONV, connectorId: "c-yax" });
    askClaude.mockResolvedValue("Resumen");

    await expect(botRespond("c1", { connectorId: "c-yax" })).resolves.toBe(false);

    expect(recordBotSilence).not.toHaveBeenCalled();
    expect(convUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "HUMAN" }) }));
  });

  it("contacto que es solo de otra marca (AI_REPLY sin cuenta): sin nota", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    contactBrandFindFirst.mockImplementation(async ({ where }: { where: { brand: { isDefault: boolean } } }) =>
      where.brand.isDefault ? null : { brandId: "b-yax" },
    );
    await expect(botRespond("c1", { createConversation: true })).resolves.toBe(false);
    expect(recordBotSilence).not.toHaveBeenCalled();
  });

  it("respuesta enviada: sin nota", async () => {
    await expect(botRespond("c1")).resolves.toBe(true);
    expect(sendChannelMessage).toHaveBeenCalledTimes(1);
    expect(recordBotSilence).not.toHaveBeenCalled();
  });
});

describe("describeAiSilence", () => {
  it("sin diagnóstico pero con error: usa el mensaje del error", () => {
    expect(describeAiSilence(undefined, new Error("Claude API 401: invalid x-api-key"))).toBe(
      "la IA no devolvió respuesta: Claude API 401: invalid x-api-key",
    );
  });

  it("respuesta vacía sin stop_reason: no inventa uno", () => {
    expect(describeAiSilence({ motivo: "respuesta_vacia", stopReason: null })).toBe(
      "la IA no devolvió respuesta: la API de Claude contestó sin texto.",
    );
  });
});

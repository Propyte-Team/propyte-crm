// El bot NUNCA contesta en el WhatsApp propio de un asesor (2026-10-14, coexistencia PR 2,
// decisión 2 del dueño). El candado está en botRespond y se ejercita aquí con el isAdvisorLine REAL
// contra un db falso: la cuenta se lee por su `scope`, y si no se puede leer, falla cerrado.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const contactFindUnique = vi.fn();
const convFindFirst = vi.fn();
const connectorFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    conversation: { findFirst: (...a: unknown[]) => convFindFirst(...a), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    leadConnector: { findUnique: (...a: unknown[]) => connectorFindUnique(...a), findFirst: vi.fn(async () => null) },
    message: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
  },
}));

const sendChannelMessage = vi.fn();
vi.mock("@/lib/messaging/dispatcher", () => ({ sendChannelMessage: (...a: unknown[]) => sendChannelMessage(...a) }));
const recordBotSilence = vi.fn();
vi.mock("@/lib/messaging/send-failure", () => ({ recordBotSendFailure: vi.fn(), recordBotSilence: (...a: unknown[]) => recordBotSilence(...a) }));
const askClaude = vi.fn();
vi.mock("./claude", () => ({ askClaude: (...a: unknown[]) => askClaude(...a), buildSystemPrompt: vi.fn(), ESCALATE_TOKEN: "[ESCALAR]" }));
vi.mock("./config", () => ({
  getBotConfig: async () => ({ botEnabled: true, enabledChannels: ["WHATSAPP"], model: "m", classifyContacts: false }),
}));
// La marca se resuelve DESPUÉS del candado: «unavailable» corta ahí sin más mocks, y que se haya
// llamado o no dice si el candado dejó pasar.
const resolveBrandForConnector = vi.fn();
vi.mock("@/lib/brands/resolve", () => ({
  resolveBrandForConnector: (...a: unknown[]) => resolveBrandForConnector(...a),
  isBrandScoped: () => false,
}));

import { botRespond } from "./bot-respond";

const scopes: Record<string, string> = { "conn-ana": "ADVISOR", "conn-yax": "BRAND" };

beforeEach(() => {
  contactFindUnique.mockReset();
  contactFindUnique.mockResolvedValue({ id: "c1", doNotContact: false, whatsappOptOut: false });
  convFindFirst.mockReset();
  convFindFirst.mockResolvedValue(null);
  connectorFindUnique.mockReset();
  connectorFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    scopes[where.id] ? { scope: scopes[where.id] } : null,
  );
  resolveBrandForConnector.mockReset();
  resolveBrandForConnector.mockResolvedValue({ kind: "unavailable", brandId: "?" });
  askClaude.mockReset();
  sendChannelMessage.mockReset();
  recordBotSilence.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("botRespond — número de asesor", () => {
  it("🚨 mensaje que llegó al número de un asesor → no contesta, ni llama a Claude, ni deja nota", async () => {
    expect(await botRespond("c1", { channel: "WHATSAPP", connectorId: "conn-ana" })).toBe(false);
    expect(connectorFindUnique).toHaveBeenCalledWith({ where: { id: "conn-ana" }, select: { scope: true } });
    expect(resolveBrandForConnector).not.toHaveBeenCalled();
    expect(askClaude).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(recordBotSilence).not.toHaveBeenCalled(); // callar aquí es lo normal
  });

  it("🚨 sin cuenta explícita, si la cuenta del hilo es de asesor → tampoco", async () => {
    convFindFirst.mockResolvedValue({ id: "conv-ana", status: "BOT", botEnabled: true, connectorId: "conn-ana" });
    expect(await botRespond("c1", { channel: "WHATSAPP" })).toBe(false);
    expect(resolveBrandForConnector).not.toHaveBeenCalled();
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("🚨 si no se puede leer la cuenta → falla cerrado (no contesta)", async () => {
    connectorFindUnique.mockRejectedValue(new Error("db caída"));
    expect(await botRespond("c1", { channel: "WHATSAPP", connectorId: "conn-yax" })).toBe(false);
    expect(resolveBrandForConnector).not.toHaveBeenCalled();
  });

  it("una línea de marca pasa el candado y sigue el camino de siempre", async () => {
    await botRespond("c1", { channel: "WHATSAPP", connectorId: "conn-yax" });
    expect(resolveBrandForConnector).toHaveBeenCalledWith("conn-yax");
  });

  it("el número global (sin cuenta) no cuesta ninguna consulta de alcance", async () => {
    await botRespond("c1", { channel: "WHATSAPP", connectorId: null });
    expect(connectorFindUnique).not.toHaveBeenCalled();
    expect(resolveBrandForConnector).toHaveBeenCalledWith(null);
  });
});

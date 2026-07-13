import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TONE_PRESETS } from "@/lib/bot/tone-presets";

// --- mocks de dependencias externas de runner.ts ---

const agentDefFindUnique = vi.fn();
const agentRunCreate = vi.fn();
const agentRunUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    agentDef: { findUnique: (...a: unknown[]) => agentDefFindUnique(...a) },
    agentRun: {
      create: (...a: unknown[]) => agentRunCreate(...a),
      update: (...a: unknown[]) => agentRunUpdate(...a),
    },
  },
}));

const getBotConfig = vi.fn();
vi.mock("@/lib/bot/config", () => ({ getBotConfig: (...a: unknown[]) => getBotConfig(...a) }));

const toolsForAgent = vi.fn();
vi.mock("./tools", () => ({ toolsForAgent: (...a: unknown[]) => toolsForAgent(...a) }));

// buildSystemPrompt real (puro) — así se puede inspeccionar el "system" de verdad
// que llega a la API, igual que en ai-actions.test.ts.
import { runAgent } from "./runner";

const AGENT = {
  id: "agent1",
  name: "Agente Reactivación",
  goal: "Reactivar leads fríos con un mensaje breve de seguimiento",
  autonomyLevel: "L2",
  allowedTools: ["escalate_to_human"],
  limits: { maxSteps: 3 },
  isActive: true,
  deletedAt: null,
  systemUser: { id: "u1", name: "Sistema Agente", role: "ADMIN" },
};

const BASE_CONFIG = {
  botEnabled: true,
  tonePreset: "EJECUTIVO_SOBRIO",
  autonomyLevel: "L2",
  model: "claude-config-model",
  openerStyle: "DIRECT",
  maxLines: 3,
  dataGateStrict: true,
  escalationTriggers: ["apartar"],
  enabledChannels: ["WHATSAPP"],
  activePlaybookId: "pb-should-be-ignored", // el runner NUNCA debe usar esto
};

function textResponse(text: string) {
  return {
    ok: true,
    json: async () => ({ content: [{ type: "text", text }], stop_reason: "end_turn" }),
    text: async () => "",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.ANTHROPIC_API_KEY = "test-key";
  agentDefFindUnique.mockResolvedValue(AGENT);
  agentRunCreate.mockResolvedValue({ id: "run1" });
  agentRunUpdate.mockResolvedValue({});
  getBotConfig.mockResolvedValue({ ...BASE_CONFIG });
  toolsForAgent.mockReturnValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("runAgent — system prompt vía buildSystemPrompt (marca+tono, sin playbook)", () => {
  it("arma el system con marca+tono de la config y el goal/identidad del agente como objetivo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse("Listo, hice seguimiento."));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAgent("agent1", "manual", {});

    expect(result).toEqual({ runId: "run1", status: "COMPLETED", output: "Listo, hice seguimiento." });
    expect(getBotConfig).toHaveBeenCalledTimes(1);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const system = body.system as string;

    // Capa marca (antes venía de SAGE_SYSTEM_PROMPT, ahora de buildBrandRules/config)
    expect(system).toContain("Propyte");
    expect(system.toLowerCase()).toContain("no inventes");
    // Capa tono: viene del preset de la config (EJECUTIVO_SOBRIO), imposible con el prompt fijo viejo
    expect(system).toContain(TONE_PRESETS.EJECUTIVO_SOBRIO.voiceGuidance.slice(0, 30));
    // Capa objetivo = identidad/goal del agente (comportamiento preservado)
    expect(system).toContain(AGENT.name);
    expect(system).toContain(AGENT.goal);
    expect(system).toContain('Operas con la identidad de "Sistema Agente"');
    // Sin capa de cliente/contacto (agente de fondo, no 1 conversación fija)
    expect(system).not.toContain("· Idioma:");
    // Sin playbook: aunque la config tenga un activePlaybookId, el runner no lo toca
    expect(system).not.toContain("pb-should-be-ignored");
    expect(system).not.toContain("Tu meta ahora:"); // texto de buildObjective() del playbook
  });

  it("preserva el resto del contrato: tool loop, autonomía y auditoría de steps", async () => {
    const escalateHandler = vi.fn().mockResolvedValue({ escalated: true, to: "u2" });
    toolsForAgent.mockReturnValue([
      {
        name: "escalate_to_human",
        description: "Escala",
        input_schema: { type: "object", properties: {} },
        allowedRoles: ["ADMIN"],
        handler: escalateHandler,
      },
    ]);

    const toolUseResponse = {
      ok: true,
      json: async () => ({
        content: [
          { type: "text", text: "Detecto intención fuerte, escalo." },
          { type: "tool_use", id: "t1", name: "escalate_to_human", input: { contactId: "c1", reason: "Quiere apartar" } },
        ],
        stop_reason: "tool_use",
      }),
      text: async () => "",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse)
      .mockResolvedValueOnce(textResponse("Escalé el caso al asesor."));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAgent("agent1", "manual", { contactId: "c1" });

    expect(result.status).toBe("ESCALATED");
    expect(result.output).toBe("Escalé el caso al asesor.");
    expect(escalateHandler).toHaveBeenCalledWith({ contactId: "c1", reason: "Quiere apartar" }, AGENT.systemUser);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const update = agentRunUpdate.mock.calls.at(-1)?.[0];
    expect(update.data.status).toBe("ESCALATED");
    expect(update.data.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ tool: "escalate_to_human" })])
    );
  });

  it("sin ANTHROPIC_API_KEY marca FAILED sin llamar a getBotConfig ni a fetch", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAgent("agent1", "manual", {});

    expect(result.status).toBe("FAILED");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getBotConfig).not.toHaveBeenCalled();
  });
});

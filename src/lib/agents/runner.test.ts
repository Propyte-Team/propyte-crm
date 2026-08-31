import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TONE_PRESETS } from "@/lib/bot/tone-presets";
import { MAX_STEPS_AGOTADOS, RESPUESTA_TRUNCADA, resumenDeCorrida } from "./run-status";

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

/**
 * #654 — el loop tiene UNA salida limpia: el `break` de cuando el modelo responde sin
 * pedir herramienta. Si pide en los `maxSteps` turnos, el `for` se acaba solo.
 *
 * Antes ese camino caía directo al update de éxito: COMPLETED con `output` en null,
 * porque `finalText` nunca se asignó. Y como `crm_fallos` solo consulta FAILED, la
 * corrida no aparecía en ningún reporte. El agente dejaba el trabajo a medias y el
 * tablero decía que todo salió bien.
 */
describe("runAgent — corrida que agota sus pasos", () => {
  function toolUseResponse() {
    return {
      ok: true,
      json: async () => ({
        content: [
          { type: "text", text: "Sigo trabajando…" },
          { type: "tool_use", id: "t1", name: "buscar", input: {} },
        ],
        stop_reason: "tool_use",
      }),
      text: async () => "",
    };
  }

  function agenteConTool() {
    toolsForAgent.mockReturnValue([
      {
        name: "buscar",
        description: "Busca",
        input_schema: { type: "object", properties: {} },
        allowedRoles: ["ADMIN"],
        handler: vi.fn().mockResolvedValue({ ok: true }),
      },
    ]);
  }

  it("NO se cierra como COMPLETED: sale FAILED con la marca de agotamiento", async () => {
    agenteConTool();
    // El agente (maxSteps: 3) pide herramienta siempre: nunca llega al break.
    const fetchMock = vi.fn().mockResolvedValue(toolUseResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAgent("agent1", "manual", {});

    expect(fetchMock).toHaveBeenCalledTimes(3); // consumió el presupuesto entero
    expect(result.status).toBe("FAILED");
    expect(result.output).toBeNull();

    const update = agentRunUpdate.mock.calls.at(-1)?.[0];
    expect(update.data.status).toBe("FAILED");
    expect(update.data.error).toContain(MAX_STEPS_AGOTADOS);
    expect(update.data.error).toContain("3 pasos");
    // Los pensamientos siguen auditables aunque no haya conclusión.
    expect(update.data.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ tool: "buscar" })]),
    );
  });

  // Escalar es un efecto real: si ocurrió, el mensaje lo dice. Pero la corrida siguió sin
  // concluir, así que no se puede cerrar como ESCALATED —eso la volvería invisible otra vez.
  it("si escaló y aun así se quedó sin pasos, lo dice sin darla por buena", async () => {
    toolsForAgent.mockReturnValue([
      {
        name: "escalate_to_human",
        description: "Escala",
        input_schema: { type: "object", properties: {} },
        allowedRoles: ["ADMIN"],
        handler: vi.fn().mockResolvedValue({ escalated: true, to: "u2" }),
      },
    ]);
    const escalaSiempre = {
      ok: true,
      json: async () => ({
        content: [{ type: "tool_use", id: "t1", name: "escalate_to_human", input: {} }],
        stop_reason: "tool_use",
      }),
      text: async () => "",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(escalaSiempre));

    const result = await runAgent("agent1", "manual", {});

    expect(result.status).toBe("FAILED");
    const update = agentRunUpdate.mock.calls.at(-1)?.[0];
    expect(update.data.error).toContain(MAX_STEPS_AGOTADOS);
    expect(update.data.error).toContain("escalar");
  });

  // Control: la salida limpia sigue siendo un éxito. Si esto se rompe, el arreglo estaría
  // marcando como fallo cualquier corrida normal.
  it("la corrida que sí concluye sigue saliendo COMPLETED y sin error", async () => {
    agenteConTool();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse())
      .mockResolvedValueOnce(textResponse("Ya está."));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runAgent("agent1", "manual", {});

    expect(result).toEqual({ runId: "run1", status: "COMPLETED", output: "Ya está." });
    const update = agentRunUpdate.mock.calls.at(-1)?.[0];
    expect(update.data.error).toBeUndefined();
  });
});

/**
 * #656 — de cada corrida se guardaba lo que el agente pensó y lo que hizo, pero no lo
 * que costó ni cuánto tardó: `usage` se descartaba al parsear y `stop_reason` se tipaba
 * sin leerse nunca. Sin eso no hay forma de saber qué agente se lleva el gasto, cuál
 * entró en un ciclo que quema dinero, ni cuál se está volviendo lento.
 */
describe("runAgent — instrumentación de la corrida", () => {
  function respuesta(over: Record<string, unknown> = {}) {
    return {
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "Listo." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 120, output_tokens: 30 },
        ...over,
      }),
      text: async () => "",
    };
  }

  it("guarda tokens y latencia del modelo en cada paso", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta()));

    await runAgent("agent1", "manual", {});

    const pasos = agentRunUpdate.mock.calls.at(-1)?.[0].data.steps as Array<Record<string, unknown>>;
    expect(pasos[0].tokens_entrada).toBe(120);
    expect(pasos[0].tokens_salida).toBe(30);
    expect(pasos[0].stop_reason).toBe("end_turn");
    expect(typeof pasos[0].ms_modelo).toBe("number");
  });

  it("el total de la corrida se puede leer de sus propios pasos", async () => {
    const conTool = {
      ok: true,
      json: async () => ({
        content: [{ type: "tool_use", id: "t1", name: "buscar", input: {} }],
        stop_reason: "tool_use",
        usage: { input_tokens: 200, output_tokens: 40 },
      }),
      text: async () => "",
    };
    toolsForAgent.mockReturnValue([
      {
        name: "buscar",
        description: "Busca",
        input_schema: { type: "object", properties: {} },
        allowedRoles: ["ADMIN"],
        handler: vi.fn().mockResolvedValue({ ok: true }),
      },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(conTool).mockResolvedValueOnce(respuesta()));

    await runAgent("agent1", "manual", {});

    const pasos = agentRunUpdate.mock.calls.at(-1)?.[0].data.steps;
    const total = resumenDeCorrida(pasos);
    expect(total.tokens_entrada).toBe(320); // 200 del turno con tool + 120 del final
    expect(total.tokens_salida).toBe(70);
    expect(total.pasos).toBe(2);
    expect(typeof total.ms_tool).toBe("number");
  });

  /**
   * 🚨 El caso caro: `max_tokens` significa que la respuesta se cortó a media frase.
   * Antes ese texto se guardaba como `output`, o sea como la conclusión del agente.
   */
  it("stop_reason max_tokens NO se guarda como conclusión", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        respuesta({ content: [{ type: "text", text: "El contacto pidió que le coti" }], stop_reason: "max_tokens" }),
      ),
    );

    const result = await runAgent("agent1", "manual", {});

    expect(result.status).toBe("FAILED");
    expect(result.output).toBeNull();
    const update = agentRunUpdate.mock.calls.at(-1)?.[0];
    expect(update.data.error).toContain(RESPUESTA_TRUNCADA);
    expect(update.data.error).not.toContain(MAX_STEPS_AGOTADOS); // la causa correcta, no la otra
    // El texto cortado sigue auditable como pensamiento, no como veredicto.
    expect(update.data.steps[0].thought).toBe("El contacto pidió que le coti");
  });

  it("max_tokens sale del default y se puede subir por agente", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta());
    vi.stubGlobal("fetch", fetchMock);

    await runAgent("agent1", "manual", {});
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).max_tokens).toBe(1000);

    agentDefFindUnique.mockResolvedValue({ ...AGENT, limits: { maxSteps: 3, maxTokens: 4000 } });
    await runAgent("agent1", "manual", {});
    expect(JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body as string).max_tokens).toBe(4000);
  });

  // Un tope sin techo deja que una config mal puesta convierta cada turno en una factura.
  it("un maxTokens desmedido se topa", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta());
    vi.stubGlobal("fetch", fetchMock);
    agentDefFindUnique.mockResolvedValue({ ...AGENT, limits: { maxSteps: 3, maxTokens: 999999 } });

    await runAgent("agent1", "manual", {});
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).max_tokens).toBe(8000);
  });

  // Control: una respuesta sin `usage` (el proveedor podría omitirlo) no debe reventar.
  it("sin usage en la respuesta, la corrida sigue y las cifras quedan en 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta({ usage: undefined })));

    const result = await runAgent("agent1", "manual", {});

    expect(result.status).toBe("COMPLETED");
    const pasos = agentRunUpdate.mock.calls.at(-1)?.[0].data.steps;
    expect(resumenDeCorrida(pasos).tokens_entrada).toBe(0);
  });
});

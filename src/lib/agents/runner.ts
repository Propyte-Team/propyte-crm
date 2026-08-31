// Runner de agentes (speckit #4 §2) — loop Claude tool-use con autonomía gobernada.
// Cada paso (razonamiento + tool call + resultado) queda en AgentRun.steps (PA1: auditable).
// Guardarraíles: tools acotadas por allowedTools∩RBAC, brand linter en send_whatsapp,
// máx pasos por limits.maxSteps (default 8), escalado registrado.
import prisma from "@/lib/db";
import { buildSystemPrompt } from "@/lib/bot/claude";
import { getBotConfig } from "@/lib/bot/config";
import { toolsForAgent, type AgentTool } from "./tools";
import { MAX_STEPS_AGOTADOS, RESPUESTA_TRUNCADA } from "./run-status";

interface ClaudeContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/**
 * La respuesta del modelo, COMPLETA.
 *
 * `usage` no estaba tipado, así que los tokens de cada turno se descartaban al parsear:
 * no había forma de saber qué agente se lleva el gasto ni de alertar sobre un loop que
 * quema dinero. `stop_reason` sí estaba tipado y no lo leía nadie.
 */
interface ClaudeResponse {
  content: ClaudeContentBlock[];
  stop_reason: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Tope de tokens por turno. Configurable por agente porque el default es bajo para un
 * loop que reinyecta resultados de tool de hasta 4000 caracteres cada uno: un objetivo
 * con varias herramientas encadenadas se topa con él antes de poder concluir.
 */
const MAX_TOKENS_DEFAULT = 1000;
const MAX_TOKENS_TOPE = 8000;

export async function runAgent(
  agentId: string,
  trigger: string,
  input: Record<string, unknown>
): Promise<{ runId: string; status: string; output: string | null }> {
  const agent = await prisma.agentDef.findUnique({
    where: { id: agentId },
    include: { systemUser: true },
  });
  if (!agent || !agent.isActive || agent.deletedAt) {
    throw new Error("Agente inexistente o inactivo");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const run = await prisma.agentRun.create({
    data: { agentId, trigger, input: input as object },
  });

  if (!apiKey) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: "ANTHROPIC_API_KEY no configurada", endedAt: new Date() },
    });
    return { runId: run.id, status: "FAILED", output: null };
  }

  const tools = toolsForAgent(agent.allowedTools, agent.systemUser);
  const limits = (agent.limits ?? {}) as { maxSteps?: number; maxTokens?: number };
  const maxSteps = Math.min(limits.maxSteps ?? 8, 15);
  const maxTokens = Math.min(limits.maxTokens ?? MAX_TOKENS_DEFAULT, MAX_TOKENS_TOPE);

  // Marca+tono vienen de la config del bot (mismo ensamblado de capas que bot-respond/
  // ai-actions vía buildSystemPrompt) — así el tono elegible también llega a los agentes
  // de fondo. El objetivo (capa 3) es la identidad/goal del propio agente: los agentes de
  // fondo NO califican leads por playbook, eso es exclusivo del flujo conversacional 1:1
  // (bot-respond/ai-actions), así que aquí NO se toca el motor de playbook.
  const config = await getBotConfig();
  const objective =
    `=== TU ROL COMO AGENTE ===\nNombre: ${agent.name}\nObjetivo: ${agent.goal}\n` +
    `Autonomía: ${agent.autonomyLevel} (L2 = autónomo en tu objetivo, escala ante duda; ` +
    `usa escalate_to_human SIEMPRE que detectes intención fuerte, queja o tema legal/fiscal).\n` +
    `Operas con la identidad de "${agent.systemUser.name}" y SOLO las herramientas listadas. ` +
    `Cuando termines, responde un resumen breve de lo que hiciste.`;
  const system = buildSystemPrompt({ config, objective });

  const messages: Array<Record<string, unknown>> = [
    { role: "user", content: JSON.stringify({ trigger, ...input }) },
  ];
  const steps: Array<Record<string, unknown>> = [];
  let finalText: string | null = null;
  let escalated = false;
  /**
   * ¿El loop salió por la puerta buena?
   *
   * Tiene UNA salida limpia: el `break` de abajo, cuando el modelo responde sin pedir
   * herramienta. Si pide en los `maxSteps` turnos, el `for` se acaba solo y antes caía
   * directo al update de éxito, con `output` en null porque nunca se asignó. Sin este
   * testigo no hay forma de distinguir «terminó» de «se le acabaron los pasos».
   */
  let concluyo = false;
  /** El último turno lo cortó el tope de tokens: lo que llegó NO es una conclusión. */
  let truncadoPorTokens = false;

  try {
    for (let step = 0; step < maxSteps; step++) {
      const t0 = Date.now();
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.BOT_MODEL ?? "claude-sonnet-4-6",
          max_tokens: maxTokens,
          system,
          messages,
          tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        }),
      });
      if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as ClaudeResponse;
      const msModelo = Date.now() - t0;
      const entrada = data.usage?.input_tokens ?? 0;
      const salida = data.usage?.output_tokens ?? 0;
      /** Lo que cuesta y lo que tarda ESTE turno, para no tener que adivinarlo después. */
      const medicion = { ms_modelo: msModelo, tokens_entrada: entrada, tokens_salida: salida };

      const toolUses = data.content.filter((b) => b.type === "tool_use");
      const text = data.content.find((b) => b.type === "text")?.text ?? null;

      if (toolUses.length === 0) {
        steps.push({ step, thought: text, stop_reason: data.stop_reason, ...medicion });
        /**
         * 🚨 `max_tokens` significa que la respuesta se cortó a media frase. Antes ese
         * texto se asignaba a `finalText` y se guardaba como la conclusión del agente:
         * una oración incompleta registrada como su veredicto. Se trata igual que el
         * agotamiento de pasos — presupuesto agotado, no éxito.
         */
        if (data.stop_reason === "max_tokens") {
          truncadoPorTokens = true;
          break;
        }
        finalText = text;
        concluyo = true;
        break;
      }

      messages.push({ role: "assistant", content: data.content });
      const toolResults: Array<Record<string, unknown>> = [];

      for (const use of toolUses) {
        const tool: AgentTool | undefined = tools.find((t) => t.name === use.name);
        const tTool = Date.now();
        let result: unknown;
        try {
          result = tool
            ? await tool.handler(use.input ?? {}, agent.systemUser)
            : { error: "Tool no permitida" };
        } catch (err) {
          result = { error: String(err instanceof Error ? err.message : err).slice(0, 300) };
        }
        if (use.name === "escalate_to_human" && (result as { escalated?: boolean })?.escalated) {
          escalated = true;
        }
        // `ms_tool` aparte de `ms_modelo`: sin separarlos, «la corrida tardó 40 s» no dice
        // si el lento fue el modelo o una herramienta, que son arreglos distintos.
        steps.push({
          step,
          thought: text,
          tool: use.name,
          input: use.input,
          result,
          ms_tool: Date.now() - tTool,
          ...medicion,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(result).slice(0, 4000),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    /**
     * Agotamiento de presupuesto = estado terminal propio, nunca un éxito.
     *
     * El agente pidió herramienta en todos los turnos disponibles y jamás dio una
     * conclusión. Guardarlo como COMPLETED con `output` vacío es el peor tipo de falla:
     * la que no se ve como falla. `crm_fallos` solo consulta FAILED, así que estas
     * corridas no aparecían en ningún reporte.
     *
     * `output` se deja en null a propósito: no hay conclusión que guardar, y meter ahí
     * el último pensamiento suelto la haría pasar por una. Los pensamientos están en
     * `steps`, que es donde se pueden leer como lo que son.
     */
    if (!concluyo) {
      const error = truncadoPorTokens
        ? `${RESPUESTA_TRUNCADA}: el modelo cortó su respuesta por tope de tokens ` +
          `(max_tokens=${maxTokens}), así que lo que llegó no es una conclusión` +
          (escalated ? " (alcanzó a escalar a un humano)" : "") +
          ". Subir `limits.maxTokens` del agente o recortarle el objetivo."
        : `${MAX_STEPS_AGOTADOS}: el agente pidió herramienta en los ${maxSteps} pasos ` +
          `disponibles y nunca dio una conclusión` +
          (escalated ? " (alcanzó a escalar a un humano antes de quedarse sin pasos)" : "") +
          ".";
      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          steps: JSON.parse(JSON.stringify(steps)),
          status: "FAILED",
          error,
          endedAt: new Date(),
        },
      });
      return { runId: run.id, status: "FAILED", output: null };
    }

    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        steps: JSON.parse(JSON.stringify(steps)),
        output: finalText,
        status: escalated ? "ESCALATED" : "COMPLETED",
        endedAt: new Date(),
      },
    });
    return { runId: run.id, status: escalated ? "ESCALATED" : "COMPLETED", output: finalText };
  } catch (err) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        steps: JSON.parse(JSON.stringify(steps)),
        status: "FAILED",
        error: String(err instanceof Error ? err.message : err).slice(0, 1000),
        endedAt: new Date(),
      },
    });
    return { runId: run.id, status: "FAILED", output: null };
  }
}

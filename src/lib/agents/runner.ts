// Runner de agentes (speckit #4 §2) — loop Claude tool-use con autonomía gobernada.
// Cada paso (razonamiento + tool call + resultado) queda en AgentRun.steps (PA1: auditable).
// Guardarraíles: tools acotadas por allowedTools∩RBAC, brand linter en send_whatsapp,
// máx pasos por limits.maxSteps (default 8), escalado registrado.
import prisma from "@/lib/db";
import { buildSystemPrompt } from "@/lib/bot/claude";
import { getBotConfig } from "@/lib/bot/config";
import { toolsForAgent, type AgentTool } from "./tools";
import { MAX_STEPS_AGOTADOS } from "./run-status";

interface ClaudeContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

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
  const limits = (agent.limits ?? {}) as { maxSteps?: number };
  const maxSteps = Math.min(limits.maxSteps ?? 8, 15);

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

  try {
    for (let step = 0; step < maxSteps; step++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.BOT_MODEL ?? "claude-sonnet-4-6",
          max_tokens: 1000,
          system,
          messages,
          tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        }),
      });
      if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { content: ClaudeContentBlock[]; stop_reason: string };

      const toolUses = data.content.filter((b) => b.type === "tool_use");
      const text = data.content.find((b) => b.type === "text")?.text ?? null;

      if (toolUses.length === 0) {
        finalText = text;
        concluyo = true;
        steps.push({ step, thought: text });
        break;
      }

      messages.push({ role: "assistant", content: data.content });
      const toolResults: Array<Record<string, unknown>> = [];

      for (const use of toolUses) {
        const tool: AgentTool | undefined = tools.find((t) => t.name === use.name);
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
        steps.push({ step, thought: text, tool: use.name, input: use.input, result });
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
      const error =
        `${MAX_STEPS_AGOTADOS}: el agente pidió herramienta en los ${maxSteps} pasos ` +
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

// Runner de agentes (speckit #4 §2) — loop Claude tool-use con autonomía gobernada.
// Cada paso (razonamiento + tool call + resultado) queda en AgentRun.steps (PA1: auditable).
// Guardarraíles: tools acotadas por allowedTools∩RBAC, brand linter en send_whatsapp,
// máx pasos por limits.maxSteps (default 8), escalado registrado.
import prisma from "@/lib/db";
import { SAGE_SYSTEM_PROMPT } from "@/lib/bot/claude";
import { toolsForAgent, type AgentTool } from "./tools";

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

  const system =
    SAGE_SYSTEM_PROMPT +
    `\n\n=== TU ROL COMO AGENTE ===\nNombre: ${agent.name}\nObjetivo: ${agent.goal}\n` +
    `Autonomía: ${agent.autonomyLevel} (L2 = autónomo en tu objetivo, escala ante duda; ` +
    `usa escalate_to_human SIEMPRE que detectes intención fuerte, queja o tema legal/fiscal).\n` +
    `Operas con la identidad de "${agent.systemUser.name}" y SOLO las herramientas listadas. ` +
    `Cuando termines, responde un resumen breve de lo que hiciste.`;

  const messages: Array<Record<string, unknown>> = [
    { role: "user", content: JSON.stringify({ trigger, ...input }) },
  ];
  const steps: Array<Record<string, unknown>> = [];
  let finalText: string | null = null;
  let escalated = false;

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

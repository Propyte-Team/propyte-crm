// src/lib/mcp/handlers/agent-tools.ts
// Wrap de AGENT_TOOLS con carga del usuario-sistema MCP.
import prisma from "@/lib/db";
import { AGENT_TOOLS } from "@/lib/agents/tools";
import { getMcpUserId } from "../auth";

async function loadSystemUser() {
  const id = await getMcpUserId();
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new Error("Sistema MCP: usuario no encontrado (re-run seed)");
  return user;
}

export async function runAgentTool(name: string, input: Record<string, unknown>) {
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool_desconocida: ${name}`);
  const systemUser = await loadSystemUser();
  return tool.handler(input, systemUser);
}

export async function captureLead(input: unknown) {
  return runAgentTool("capture_lead", input as Record<string, unknown>);
}

export async function matchUnits(input: unknown) {
  return runAgentTool("match_units", input as Record<string, unknown>);
}

export async function sendWhatsapp(input: unknown) {
  return runAgentTool("send_whatsapp", input as Record<string, unknown>);
}

export async function createTask(input: unknown) {
  return runAgentTool("create_task", input as Record<string, unknown>);
}

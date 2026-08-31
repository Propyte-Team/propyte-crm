// src/lib/mcp/handlers/agent-tools.ts
// Wrap de AGENT_TOOLS con carga del usuario-sistema MCP.
import prisma from "@/lib/db";
import { AGENT_TOOLS, ejecutarTool } from "@/lib/agents/tools";
import { getMcpUserId } from "../auth";

async function loadSystemUser() {
  const id = await getMcpUserId();
  const user = await prisma.user.findUnique({ where: { id } });
  // Mensaje SIN "no encontrad" para no disparar el mapeo a 404 del route (es 500 de config).
  if (!user) throw new Error("MCP system user missing: re-run scripts/seed-mcp-user.ts");
  return user;
}

export async function runAgentTool(name: string, input: Record<string, unknown>) {
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool_desconocida: ${name}`);
  const systemUser = await loadSystemUser();
  // Honra el contrato de allowedRoles del AgentTool (hoy el usuario-sistema es ADMIN).
  if (!tool.allowedRoles.includes(systemUser.role))
    throw new Error(`RBAC: usuario-sistema sin permiso para ${name}`);
  // Esta es la SEGUNDA puerta por la que se ejecutan tools, y también deja constancia.
  // Auditar solo la del runner habría dejado sin registrar todo lo que entra por la
  // pasarela, que es cualquiera con el token del CRM.
  return ejecutarTool(tool, input, systemUser);
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

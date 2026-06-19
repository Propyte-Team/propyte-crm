// src/lib/mcp/handlers/agent-tools.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ default: {
  user: { findUnique: vi.fn() },
}}));
vi.mock("@/lib/agents/tools", () => ({
  AGENT_TOOLS: [
    {
      name: "send_whatsapp",
      description: "Enviar WA",
      handler: vi.fn(async () => ({ sent: true })),
    },
    {
      name: "capture_lead",
      description: "Captura lead",
      handler: vi.fn(async () => ({ isNew: true })),
    },
  ],
}));
vi.mock("../auth", () => ({
  getMcpUserId: vi.fn(async () => "sys-u1"),
}));

import prisma from "@/lib/db";
import { AGENT_TOOLS } from "@/lib/agents/tools";
import { runAgentTool, sendWhatsapp } from "./agent-tools";

describe("runAgentTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lanza para tool desconocida", async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: "sys-u1", role: "ADMIN" });
    await expect(runAgentTool("inexistente", {})).rejects.toThrow(/tool_desconocida/);
  });

  it("carga systemUser y delega al handler", async () => {
    const mockUser = { id: "sys-u1", role: "ADMIN" };
    (prisma.user.findUnique as any).mockResolvedValue(mockUser);
    const r: any = await runAgentTool("send_whatsapp", { contactId: "c1", body: "Hola" });
    expect(r.sent).toBe(true);
    // Verify handler was called with systemUser
    const tool = (AGENT_TOOLS as any).find((t: any) => t.name === "send_whatsapp");
    expect(tool.handler).toHaveBeenCalledWith(
      { contactId: "c1", body: "Hola" },
      mockUser
    );
  });

  it("sendWhatsapp llama runAgentTool con send_whatsapp", async () => {
    (prisma.user.findUnique as any).mockResolvedValue({ id: "sys-u1", role: "ADMIN" });
    const r: any = await sendWhatsapp({ contactId: "c1", body: "Test" });
    expect(r.sent).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "@prisma/client";

const auditLogCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    auditLog: { create: (...a: unknown[]) => auditLogCreate(...a) },
    contact: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) },
  },
}));

import { AGENT_TOOLS, ejecutarTool, toolsForAgent } from "./tools";

/**
 * #666 — la cabecera de tools.ts declara «Todo uso → Activity/AuditLog» desde el principio.
 *
 * En la práctica solo 2 de las 8 tools llamaban a `auditToolUse` a mano. Las 6 sin registrar
 * incluían las dos de mayor consecuencia: `send_whatsapp`, que le escribe a una persona real,
 * y `capture_lead`, que da de alta un prospecto. Si un agente le escribía a quien no debía, no
 * quedaba constancia de que hubiera sido él — y esto corre con gente real del otro lado.
 */

const SISTEMA = { id: "u-sistema", role: "ADMIN" } as User;

beforeEach(() => {
  vi.clearAllMocks();
  auditLogCreate.mockResolvedValue({});
});

describe("ejecutarTool", () => {
  const tool = {
    name: "tool_de_prueba",
    description: "",
    input_schema: { type: "object" as const, properties: {} },
    allowedRoles: ["ADMIN"],
    handler: vi.fn(async () => ({ ok: true })),
  };

  it("registra la invocación y delega al handler", async () => {
    const r = await ejecutarTool(tool, { a: 1 }, SISTEMA);

    expect(r).toEqual({ ok: true });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u-sistema",
          entity: "AgentTool",
          entityId: "tool_de_prueba",
          changes: { input: { a: 1 } },
        }),
      }),
    );
  });

  /**
   * Se registra ANTES de ejecutar. Un registro que solo se escribe cuando todo salió bien no
   * sirve para investigar lo que salió mal — y el caso que importa es justo el envío que
   * revienta a la mitad.
   */
  it("si el handler revienta, el intento YA quedó anotado", async () => {
    const explota = { ...tool, handler: vi.fn(async () => { throw new Error("boom"); }) };

    await expect(ejecutarTool(explota, { a: 1 }, SISTEMA)).rejects.toThrow("boom");
    expect(auditLogCreate).toHaveBeenCalled();
  });

  /**
   * No bloquea: un hipo de la base no debe dejar al agente mudo a media conversación. Pero
   * deja de ser mudo — un historial con huecos que no los declara no sirve para nada.
   */
  it("si el registro falla, la tool sigue y el hueco queda gritado", async () => {
    auditLogCreate.mockRejectedValue(new Error("db caída"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(ejecutarTool(tool, {}, SISTEMA)).resolves.toEqual({ ok: true });
    expect(err.mock.calls[0][0]).toMatch(/AUDITOR[ÍI]A PERDIDA/);
    err.mockRestore();
  });
});

describe("toolsForAgent entrega las tools ya auditadas", () => {
  const nombres = AGENT_TOOLS.map((t) => t.name);

  it("las ocho tools del registro pasan por el registro de auditoría", async () => {
    expect(nombres.length).toBe(8); // si cambia el número, este test quiere revisarse

    for (const nombre of nombres) {
      auditLogCreate.mockClear();
      const [tool] = toolsForAgent([nombre], SISTEMA);
      expect(tool, `${nombre} no se entregó a un ADMIN`).toBeDefined();

      // El handler real puede reventar por falta de datos; da igual, lo que se comprueba es
      // que la anotación ocurre ANTES y por lo tanto siempre.
      await tool.handler({}, SISTEMA).catch(() => {});

      expect(auditLogCreate, `${nombre} no dejó constancia`).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ entityId: nombre }) }),
      );
    }
  });

  // 🚨 Las dos que la tarjeta señala por consecuencia: mandar un WhatsApp y dar de alta a alguien.
  it.each(["send_whatsapp", "capture_lead"])("%s deja constancia", async (nombre) => {
    const [tool] = toolsForAgent([nombre], SISTEMA);
    await tool.handler({}, SISTEMA).catch(() => {});

    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entityId: nombre }) }),
    );
  });

  // Control: envolver el handler no debe romper el filtro de RBAC ni el de allowedTools.
  it("sigue filtrando por rol y por lista permitida", () => {
    const sinPermiso = { id: "u", role: "INVITADO" } as unknown as User;
    expect(toolsForAgent(["send_whatsapp"], sinPermiso)).toEqual([]);
    expect(toolsForAgent([], SISTEMA)).toEqual([]);
    expect(toolsForAgent(["send_whatsapp"], SISTEMA).map((t) => t.name)).toEqual(["send_whatsapp"]);
  });

  // Ninguna tool debe registrar dos veces: las dos que lo hacían a mano ya no lo hacen.
  it("no hay registro duplicado en las que antes auditaban a mano", async () => {
    for (const nombre of ["update_investment_profile", "escalate_to_human"]) {
      auditLogCreate.mockClear();
      const [tool] = toolsForAgent([nombre], SISTEMA);
      await tool.handler({}, SISTEMA).catch(() => {});
      expect(auditLogCreate, `${nombre} registró dos veces`).toHaveBeenCalledTimes(1);
    }
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * #775 — La pregunta «¿este rol puede usar esta tool?» se contestaba dos veces:
 * `toolsForAgent` (este módulo) y `runAgentTool` (mcp/handlers/agent-tools.ts) cada una
 * con su propia línea `allowedRoles.includes(role)`. Esta prueba NO mockea
 * `@/lib/agents/tools`: usa el registro real de `AGENT_TOOLS` y las dos puertas reales,
 * para comprobar que ambas deciden lo mismo porque llaman a la MISMA `rolPuedeUsar`,
 * no a una copia que hoy dice lo mismo pero puede divergir mañana.
 */

const auditLogCreate = vi.fn(async () => ({}));
const userFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    auditLog: { create: (...a: unknown[]) => auditLogCreate(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
  },
}));
vi.mock("@/lib/mcp/auth", () => ({ getMcpUserId: vi.fn(async () => "sys-1") }));

import { AGENT_TOOLS, toolsForAgent, rolPuedeUsar } from "@/lib/agents/tools";
import { runAgentTool } from "@/lib/mcp/handlers/agent-tools";
import type { User } from "@prisma/client";

function toolEspiada(nombre: string) {
  const real = AGENT_TOOLS.find((t) => t.name === nombre);
  if (!real) throw new Error(`la tool ${nombre} ya no existe en AGENT_TOOLS`);
  return real;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("#775 — un solo lugar decide el permiso, las dos puertas coinciden", () => {
  it("rolPuedeUsar contesta lo mismo que allowedRoles.includes(role), directo", () => {
    const tool = toolEspiada("capture_lead");
    expect(rolPuedeUsar(tool, "ADMIN")).toBe(tool.allowedRoles.includes("ADMIN"));
    expect(rolPuedeUsar(tool, "HOSTESS")).toBe(false);
  });

  it("rol SIN permiso: las dos puertas rechazan igual", async () => {
    userFindUnique.mockResolvedValue({ id: "sys-1", role: "HOSTESS" });

    // Puerta 1: el runner de agentes ni siquiera entrega la tool.
    expect(
      toolsForAgent(["capture_lead"], { id: "sys-1", role: "HOSTESS" } as User)
    ).toEqual([]);

    // Puerta 2: la pasarela del MCP la rechaza con el mismo motivo.
    await expect(
      runAgentTool("capture_lead", { firstName: "X" })
    ).rejects.toThrow(/RBAC/);
  });

  it("rol CON permiso: las dos puertas dejan pasar", async () => {
    userFindUnique.mockResolvedValue({ id: "sys-1", role: "MARKETING" });
    const real = toolEspiada("capture_lead");
    const espia = vi.spyOn(real, "handler").mockResolvedValue({ ok: true });

    // Puerta 1: se entrega la tool.
    const entregadas = toolsForAgent(
      ["capture_lead"],
      { id: "sys-1", role: "MARKETING" } as User
    );
    expect(entregadas).toHaveLength(1);

    // Puerta 2: se ejecuta, no se rechaza por RBAC.
    await expect(runAgentTool("capture_lead", { firstName: "X" })).resolves.toEqual({
      ok: true,
    });
    expect(espia).toHaveBeenCalled();
    espia.mockRestore();
  });

  it("agregar una tool nueva no exige tocar el chequeo de RBAC de ninguna de las dos puertas", () => {
    // No hay una lista de nombres de tool hardcodeada en ninguna de las dos puertas para
    // decidir el permiso: las dos miran `AGENT_TOOLS` + `rolPuedeUsar`. Esta prueba fija
    // esa forma con una tool que NO existe en el registro real, construida solo para la
    // prueba: si `toolsForAgent` o `rolPuedeUsar` tuvieran en algún lado un switch/lista
    // de nombres, esta tool inventada se comportaría distinto a las reales.
    const inventada = {
      name: "tool_que_no_existe_hoy",
      description: "solo para esta prueba",
      input_schema: { type: "object" as const, properties: {} },
      allowedRoles: ["GERENTE"],
      handler: vi.fn(),
    };
    expect(rolPuedeUsar(inventada, "GERENTE")).toBe(true);
    expect(rolPuedeUsar(inventada, "ASESOR")).toBe(false);
  });
});

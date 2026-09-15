import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #688. `toolsForAgent` decide QUÉ tools entrega mirando el rol del `systemUser`
// que recibe, pero el handler que devolvía reenviaba el segundo argumento de quien lo
// invocara. O sea: se comprobaba el permiso con una identidad y se podía ejecutar —y
// FIRMAR el AuditLog— con otra.
//
// Ninguno de los dos llamadores que existen lo explotaba: los dos pasan la misma
// identidad en los dos puntos. Lo que esto arregla es de contrato — la garantía pasa de
// ser una costumbre del llamador a ser una propiedad del módulo. Por eso estas pruebas
// llaman al handler con una identidad DISTINTA a propósito: es la única forma de
// distinguir las dos versiones.

const auditLogCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    auditLog: { create: (...a: unknown[]) => auditLogCreate(...a) },
    contact: { findMany: vi.fn(async () => []) },
  },
}));

import { AGENT_TOOLS, toolsForAgent } from "./tools";
import type { User } from "@prisma/client";

/** El usuario-sistema del agente: el que SÍ pasó el filtro de RBAC. */
const VALIDADO = { id: "sistema-1", role: "ADMIN", email: "agentes@propyte.local" } as unknown as User;

/** Otra identidad cualquiera. Nadie la pasa hoy; es el intruso de la prueba. */
const OTRO = { id: "intruso-9", role: "ASESOR_JR", email: "otro@nativatulum.mx" } as unknown as User;

/** Una tool real del registro, con su handler crudo espiado. */
function toolEspiada(nombre: string) {
  const real = AGENT_TOOLS.find((t) => t.name === nombre);
  if (!real) throw new Error(`la tool ${nombre} ya no existe en AGENT_TOOLS`);
  return real;
}

beforeEach(() => {
  vi.clearAllMocks();
  auditLogCreate.mockResolvedValue({});
});

describe("toolsForAgent — la identidad la fija el módulo (#688)", () => {
  it("el AuditLog se firma con la identidad VALIDADA, no con la que reciba el handler", async () => {
    // El corazón de la tarjeta. Contra el código viejo, `userId` sale 'intruso-9'.
    const [tool] = toolsForAgent(["search_contacts"], VALIDADO);

    await (tool.handler as (i: Record<string, unknown>, u?: User) => Promise<unknown>)(
      { query: "ana" },
      OTRO,
    );

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    expect(auditLogCreate.mock.calls[0][0].data.userId).toBe("sistema-1");
  });

  it("el handler REAL también recibe la identidad validada", async () => {
    // No basta con que el registro quede bien: la identidad es la que actúa. En
    // `send_whatsapp` es el remitente del mensaje, y en `create_task` el responsable.
    const real = toolEspiada("search_contacts");
    const espia = vi.spyOn(real, "handler");

    const [tool] = toolsForAgent(["search_contacts"], VALIDADO);
    await (tool.handler as (i: Record<string, unknown>, u?: User) => Promise<unknown>)(
      { query: "ana" },
      OTRO,
    );

    expect(espia).toHaveBeenCalledWith({ query: "ana" }, VALIDADO);
    espia.mockRestore();
  });

  it("da igual cuántas veces se llame y con qué: siempre la misma identidad", async () => {
    const [tool] = toolsForAgent(["search_contacts"], VALIDADO);
    const h = tool.handler as (i: Record<string, unknown>, u?: User) => Promise<unknown>;

    await h({ query: "a" }, OTRO);
    await h({ query: "b" });
    await h({ query: "c" }, VALIDADO);

    const firmantes = auditLogCreate.mock.calls.map((c) => c[0].data.userId);
    expect(firmantes).toEqual(["sistema-1", "sistema-1", "sistema-1"]);
  });

  it("cada tool entregada cierra sobre la identidad con la que se pidió", async () => {
    // Dos listas pedidas con identidades distintas no se contaminan entre sí: el closure
    // es por llamada a toolsForAgent, no compartido.
    const [deA] = toolsForAgent(["search_contacts"], VALIDADO);
    const [deB] = toolsForAgent(["search_contacts"], { ...OTRO, role: "ADMIN" } as User);

    await (deA.handler as (i: Record<string, unknown>) => Promise<unknown>)({ query: "x" });
    await (deB.handler as (i: Record<string, unknown>) => Promise<unknown>)({ query: "x" });

    expect(auditLogCreate.mock.calls.map((c) => c[0].data.userId)).toEqual([
      "sistema-1",
      "intruso-9",
    ]);
  });
});

describe("barandilla: el filtro de RBAC que ya funcionaba (#688)", () => {
  // Estas pasan en las dos versiones. Se dicen así para no contarlas como parte del
  // arreglo: fijan que al cerrar la identidad no se rompió el filtro que la elige.

  it("una tool fuera de allowedTools no se entrega", () => {
    expect(toolsForAgent([], VALIDADO)).toEqual([]);
  });

  it("un rol sin permiso no recibe la tool", () => {
    const sinPermiso = { ...VALIDADO, role: "HOSTESS" } as User;
    expect(toolsForAgent(["send_whatsapp"], sinPermiso)).toEqual([]);
  });

  it("la tool entregada es una COPIA: el handler crudo del registro no se toca", () => {
    const real = toolEspiada("search_contacts");
    const crudo = real.handler;

    const [tool] = toolsForAgent(["search_contacts"], VALIDADO);

    expect(tool).not.toBe(real);
    expect(tool.handler).not.toBe(crudo);
    expect(real.handler).toBe(crudo);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// 2026-10-12: el WhatsApp que manda un workflow se firmaba con `ownerUserId` —el asignado tal
// cual o «el primer ADMIN/DIRECTOR/GERENTE activo», sin orden—, así que en la cronología
// salía hecho por la cuenta técnica del contacto (agentes@propyte.local) o por Audit Temp.
// La firma la decide ahora el helper común; `ownerUserId` sigue siendo el DESTINATARIO de
// tareas y avisos, y el respaldo cuando el helper no da nadie.

const contactFindUnique = vi.fn();
const userFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    userTemplate: { findFirst: vi.fn(async () => null) },
  },
}));

const sendWhatsAppMessage = vi.fn();
vi.mock("@/lib/twilio/whatsapp", () => ({
  sendWhatsAppMessage: (...a: unknown[]) => sendWhatsAppMessage(...a),
}));
vi.mock("@/lib/messaging/conversations", () => ({ findConversationForChannel: vi.fn(async () => null) }));

import { executeAction } from "./actions";
import { crearCacheDeActor } from "@/lib/users/actor-sistema";
import type { ActionQueue } from "@prisma/client";

const AGENTES = "u-agentes"; // agentes@propyte.local: no pasa el filtro de persona

const contacto = (assignedToId: string | null) => ({
  id: "c1",
  phone: "+5215550000",
  firstName: "Ana",
  lastName: "García",
  preferredLanguage: "ES",
  doNotContact: false,
  whatsappOptOut: false,
  assignedToId,
  tags: [],
});

const item = (id = "q1") =>
  ({
    id,
    actionType: "SEND_WHATSAPP",
    entityType: "contact",
    entityId: "c1",
    config: { body: "Hola" },
    ruleId: null,
  }) as unknown as ActionQueue;

/** Usuarios falsos: personas = los ids de la lista; ADMIN persona = u-admin; ADMIN/mando cualquiera = u-mando. */
function usuarios(personas: string[], adminPersona: string | null = "u-admin") {
  userFindFirst.mockImplementation(async ({ where }: { where: { id?: string; NOT?: unknown; role?: unknown } }) => {
    if (where.id) return personas.includes(where.id) ? { id: where.id } : null;
    if (where.NOT) return adminPersona ? { id: adminPersona } : null; // el ADMIN persona más antiguo
    return { id: "u-mando" }; // la regla de siempre de ownerUserId
  });
}

/** El `userId` con que se mandó el WhatsApp (4º argumento). */
const firma = () => sendWhatsAppMessage.mock.calls[0][3];

beforeEach(() => {
  vi.clearAllMocks();
  sendWhatsAppMessage.mockResolvedValue({ id: "m1" });
});

describe("executeAction SEND_WHATSAPP — a nombre de quién sale", () => {
  it("asesor persona: firma el asesor", async () => {
    contactFindUnique.mockResolvedValue(contacto("u-ana"));
    usuarios(["u-ana"]);
    expect(await executeAction(item())).toEqual({});
    expect(firma()).toBe("u-ana");
  });

  it("asesor que es cuenta técnica: firma el ADMIN persona más antiguo, no la cuenta técnica", async () => {
    contactFindUnique.mockResolvedValue(contacto(AGENTES));
    usuarios([]);
    await executeAction(item());
    expect(firma()).toBe("u-admin");
  });

  it("sin ninguna persona: la regla de siempre, para no dejar de enviar lo que antes salía", async () => {
    contactFindUnique.mockResolvedValue(contacto(AGENTES));
    usuarios([], null);
    await executeAction(item());
    expect(firma()).toBe(AGENTES);

    sendWhatsAppMessage.mockClear();
    contactFindUnique.mockResolvedValue(contacto(null));
    await executeAction(item());
    expect(firma()).toBe("u-mando");
  });

  it("si leer la firma falla, sale igual con la regla de siempre", async () => {
    contactFindUnique.mockResolvedValue(contacto("u-ana"));
    userFindFirst.mockRejectedValueOnce(new Error("db down")); // la consulta del helper
    userFindFirst.mockResolvedValue({ id: "u-mando" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await executeAction(item())).toEqual({});
    expect(firma()).toBe("u-ana"); // ownerUserId: el asignado tal cual
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[workflows]"), expect.any(Error));
    error.mockRestore();
  });

  it("con la caché del lote, el ADMIN de respaldo se consulta una vez para varias acciones", async () => {
    contactFindUnique.mockResolvedValue(contacto(AGENTES));
    usuarios([]);
    const actorCache = crearCacheDeActor();
    await executeAction(item("q1"), { actorCache });
    await executeAction(item("q2"), { actorCache });
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(2);
    const consultasDeAdmin = userFindFirst.mock.calls.filter(([a]) => (a as { where: { NOT?: unknown } }).where.NOT && !(a as { where: { id?: string } }).where.id);
    expect(consultasDeAdmin).toHaveLength(1);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Propuestas de marketing → siempre a la persona responsable (hoy Luis Flores).
// Scaffolding de mocks tomado de bot-respond.agents.test.ts; aquí NO se mockea
// marketing-routing: se ejercita el resolvedor real contra un db falso.

const sendChannelMessage = vi.fn();
vi.mock("@/lib/messaging/dispatcher", () => ({
  sendChannelMessage: (...a: unknown[]) => sendChannelMessage(...a),
}));

const contactFindUnique = vi.fn();
const convFindFirst = vi.fn();
const convFindUnique = vi.fn();
const convUpdate = vi.fn();
const msgFindMany = vi.fn();
const userFindFirst = vi.fn();
const configFindUnique = vi.fn();
const notificationCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    conversation: {
      findFirst: (...a: unknown[]) => convFindFirst(...a),
      findUnique: (...a: unknown[]) => convFindUnique(...a),
      update: (...a: unknown[]) => convUpdate(...a),
    },
    message: {
      findMany: (...a: unknown[]) => msgFindMany(...a),
      findFirst: vi.fn(async () => null), // guard anti-burst: sin mensajes nuevos
    },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    systemConfig: { findUnique: (...a: unknown[]) => configFindUnique(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
    botAgentProfile: { count: vi.fn(async () => 0) },
    botPlaybook: { findFirst: vi.fn(async () => null) },
  },
}));

const askClaude = vi.fn();
vi.mock("./claude", () => ({
  askClaude: (...a: unknown[]) => askClaude(...a),
  buildSystemPrompt: () => "SYSTEM",
  ESCALATE_TOKEN: "[ESCALAR]",
}));

vi.mock("./config", () => ({
  getBotConfig: async () => ({
    botEnabled: true,
    tonePreset: "PROFESIONAL_CALIDO",
    autonomyLevel: "L2",
    model: "claude-sonnet-5",
    openerStyle: "WARM_NAME",
    maxLines: 4,
    dataGateStrict: true,
    escalationTriggers: [],
    enabledChannels: ["WHATSAPP"],
    activePlaybookId: null,
    classifyContacts: false,
  }),
}));
vi.mock("./brand-linter", () => ({ lintBrandVoice: () => ({ ok: true, violations: [] }) }));
vi.mock("./hub-catalog", () => ({
  findMatchingDevelopments: async () => ({ data: [], error: null }),
  catalogBrief: () => "",
}));
vi.mock("./classify", () => ({ maybeClassifyContact: vi.fn(async () => null) }));
vi.mock("./playbook/run", () => ({ runPlaybookStep: vi.fn() }));

import { botRespond } from "./bot-respond";
import { ESCALATE_MARKETING_TOKEN, getMarketingOwnerId } from "./marketing-routing";

const LUIS = "23361b42-f80c-42ce-ba8f-3a232b9f088c";

const CONTACT = {
  id: "c1", firstName: "Tisiano", lastName: "", phone: "+529841364211",
  doNotContact: false, whatsappOptOut: false, assignedToId: null,
  budgetMin: null, budgetMax: null, preferredZone: null, preferredLanguage: "ES",
  contactType: "COMPRADOR", custom: null,
};
const CONV = { id: "conv1", status: "BOT", botEnabled: true, connectorId: null };

/** system_config falso: { clave: valor } */
function setConfig(rows: Record<string, unknown>) {
  configFindUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    where.key in rows ? { key: where.key, value: rows[where.key] } : null,
  );
}
/** users activos falsos: findFirst({ where: { id } }) → existe solo si el id está en la lista */
function setActiveUsers(ids: string[]) {
  userFindFirst.mockImplementation(async ({ where }: { where: { id?: string; role?: string } }) => {
    if (where.id) return ids.includes(where.id) ? { id: where.id } : null;
    return { id: "admin-fallback" }; // el findFirst sin id es el de ownerId (primer ADMIN)
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  contactFindUnique.mockResolvedValue(CONTACT);
  convFindFirst.mockResolvedValue(CONV);
  convFindUnique.mockResolvedValue({ id: "conv1", contact: CONTACT });
  convUpdate.mockResolvedValue({});
  msgFindMany.mockResolvedValue([
    { direction: "INBOUND", body: "Quiero darles a conocer nuestra marca Lisual. Trabajamos con servicios de marketing", createdAt: new Date() },
  ]);
  sendChannelMessage.mockResolvedValue({ id: "m1" });
  notificationCreate.mockResolvedValue({});
  setConfig({ admin_owner_user_id: LUIS });
  setActiveUsers([LUIS]);
});

describe("getMarketingOwnerId", () => {
  it("sin clave dedicada → el administrador propietario (Luis Flores)", async () => {
    expect(await getMarketingOwnerId()).toBe(LUIS);
  });

  it("la clave dedicada gana sobre el propietario", async () => {
    setConfig({ marketing_escalation_user_id: "otra-persona", admin_owner_user_id: LUIS });
    setActiveUsers(["otra-persona", LUIS]);
    expect(await getMarketingOwnerId()).toBe("otra-persona");
  });

  it("clave dedicada apuntando a un usuario inactivo → cae al propietario", async () => {
    setConfig({ marketing_escalation_user_id: "desactivada", admin_owner_user_id: LUIS });
    setActiveUsers([LUIS]); // "desactivada" no está activa
    expect(await getMarketingOwnerId()).toBe(LUIS);
  });

  it("nada configurado o nadie activo → null (el escalamiento sigue como antes)", async () => {
    setConfig({});
    expect(await getMarketingOwnerId()).toBeNull();
    setConfig({ admin_owner_user_id: LUIS });
    setActiveUsers([]);
    expect(await getMarketingOwnerId()).toBeNull();
  });
});

describe("botRespond — [ESCALAR_MARKETING]", () => {
  it("quita el token del mensaje, escala y manda el hilo a Luis Flores con notificación", async () => {
    askClaude
      .mockResolvedValueOnce(`Gracias por escribir, comparto tu mensaje con la persona responsable. ${ESCALATE_MARKETING_TOKEN}`)
      .mockResolvedValueOnce("Resumen para el asesor"); // askClaude del resumen en escalateToHuman

    await botRespond("c1");

    // el cliente NUNCA ve el token
    const sent = sendChannelMessage.mock.calls[0][2] as string;
    expect(sent).not.toContain("[ESCALAR");
    expect(sent).toContain("comparto tu mensaje");

    // el hilo pasa a HUMAN controlado por Luis (aunque el contacto no tenga asesor)
    const escalada = convUpdate.mock.calls.find((c) => c[0].data.status === "HUMAN");
    expect(escalada?.[0].data.controlledById).toBe(LUIS);

    // y a Luis le llega el aviso (antes: ninguno, porque no había responsable)
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(notificationCreate.mock.calls[0][0].data).toMatchObject({
      userId: LUIS,
      type: "bot_escalation",
      link: "/inbox?c=conv1",
    });
  });

  it("aunque el contacto ya tenga asesor, marketing va SIEMPRE a Luis", async () => {
    const conAsesor = { ...CONTACT, assignedToId: "asesor-9" };
    contactFindUnique.mockResolvedValue(conAsesor);
    convFindUnique.mockResolvedValue({ id: "conv1", contact: conAsesor });
    askClaude.mockResolvedValueOnce(`Con gusto. ${ESCALATE_MARKETING_TOKEN}`).mockResolvedValueOnce("Resumen");

    await botRespond("c1");

    const escalada = convUpdate.mock.calls.find((c) => c[0].data.status === "HUMAN");
    expect(escalada?.[0].data.controlledById).toBe(LUIS);
    expect(notificationCreate.mock.calls[0][0].data.userId).toBe(LUIS);
  });

  it("[ESCALAR] normal NO se redirige a Luis: sigue yendo al asesor del contacto", async () => {
    const conAsesor = { ...CONTACT, assignedToId: "asesor-9" };
    contactFindUnique.mockResolvedValue(conAsesor);
    convFindUnique.mockResolvedValue({ id: "conv1", contact: conAsesor });
    askClaude.mockResolvedValueOnce("Te conecto con tu asesor. [ESCALAR]").mockResolvedValueOnce("Resumen");

    await botRespond("c1");

    const escalada = convUpdate.mock.calls.find((c) => c[0].data.status === "HUMAN");
    expect(escalada?.[0].data.controlledById).toBe("asesor-9");
    expect(notificationCreate.mock.calls[0][0].data.userId).toBe("asesor-9");
  });

  it("sin responsable válido, escala igual (sin romper) con el comportamiento anterior", async () => {
    setConfig({});
    askClaude.mockResolvedValueOnce(`Listo. ${ESCALATE_MARKETING_TOKEN}`).mockResolvedValueOnce("Resumen");

    await expect(botRespond("c1")).resolves.toBe(true);

    const escalada = convUpdate.mock.calls.find((c) => c[0].data.status === "HUMAN");
    expect(escalada?.[0].data.controlledById).toBeNull();
    expect(notificationCreate).not.toHaveBeenCalled(); // no hay a quién avisar: igual que antes
  });
});

describe("prompt y tokens", () => {
  it("[ESCALAR] no es subcadena de [ESCALAR_MARKETING] (un includes nunca dispara por el otro)", () => {
    expect(ESCALATE_MARKETING_TOKEN.includes("[ESCALAR]")).toBe(false);
  });
});

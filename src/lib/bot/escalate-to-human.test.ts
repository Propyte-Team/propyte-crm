import { describe, it, expect, vi, beforeEach } from "vitest";

// #858 (2026-10-14): escalateToHuman con un contacto SIN asesor dejaba la conversación en
// HUMAN con controlledById null y no le avisaba a nadie. Caso real: conversación 9c1379d8
// (valuador de BBVA, 2026-10-12 16:15), dos días sin respuesta. A quién se avisa y el dedup
// se prueban en lib/messaging/aviso-sin-dueno.test.ts; aquí, que escalateToHuman lo pida
// con los datos correctos y que con dueño todo siga igual.

vi.mock("@/lib/messaging/dispatcher", () => ({ sendChannelMessage: vi.fn() }));

const convFindUnique = vi.fn();
const convUpdate = vi.fn();
const msgFindMany = vi.fn();
const notificationCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    conversation: {
      findUnique: (...a: unknown[]) => convFindUnique(...a),
      update: (...a: unknown[]) => convUpdate(...a),
    },
    message: { findMany: (...a: unknown[]) => msgFindMany(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
  },
}));

const askClaude = vi.fn();
vi.mock("./claude", () => ({
  askClaude: (...a: unknown[]) => askClaude(...a),
  buildSystemPrompt: () => "SYSTEM",
  ESCALATE_TOKEN: "[ESCALAR]",
}));

const avisarHiloSinDueno = vi.fn();
vi.mock("@/lib/messaging/aviso-sin-dueno", () => ({
  avisarHiloSinDueno: (...a: unknown[]) => avisarHiloSinDueno(...a),
}));

import { escalateToHuman } from "./bot-respond";

const SIN_DUENO = {
  id: "conv-bbva",
  connectorId: null,
  contact: { id: "c1", firstName: "Valuador", lastName: "BBVA", assignedToId: null, targetPlaza: null },
};

beforeEach(() => {
  vi.resetAllMocks();
  msgFindMany.mockResolvedValue([{ direction: "INBOUND", body: "Necesito coordinar el avalúo" }]);
  askClaude.mockResolvedValue("Pide coordinar la inspección para un avalúo.");
  convUpdate.mockResolvedValue({});
  notificationCreate.mockResolvedValue({});
  avisarHiloSinDueno.mockResolvedValue(["admin-1"]);
});

describe("escalateToHuman — conversación sin dueño (#858)", () => {
  it("pasa a HUMAN sin inventar controlledById, y avisa por el camino de hilo sin dueño", async () => {
    convFindUnique.mockResolvedValue(SIN_DUENO);
    await escalateToHuman("conv-bbva", "Intención fuerte detectada por el bot");

    expect(convUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "HUMAN", controlledById: null }) }),
    );
    expect(notificationCreate).not.toHaveBeenCalled(); // el aviso de siempre no tiene a quién
    expect(avisarHiloSinDueno).toHaveBeenCalledTimes(1);
    const arg = avisarHiloSinDueno.mock.calls[0][0];
    expect(arg).toEqual(
      expect.objectContaining({ conversationId: "conv-bbva", connectorId: null, plaza: null, type: "bot_escalation" }),
    );
    expect(arg.message).toContain("Valuador BBVA");
    expect(arg.message).toContain("avalúo");
  });

  it("le pasa la cuenta del hilo (de ahí sale la marca) y la plaza del contacto", async () => {
    convFindUnique.mockResolvedValue({
      ...SIN_DUENO,
      connectorId: "c-yax",
      contact: { ...SIN_DUENO.contact, targetPlaza: "MERIDA" },
    });
    await escalateToHuman("conv-bbva", "Agente de la marca «Yaxnáh» apagado");
    expect(avisarHiloSinDueno).toHaveBeenCalledWith(expect.objectContaining({ connectorId: "c-yax", plaza: "MERIDA" }));
  });

  it("si el aviso truena, el escalamiento ya quedó hecho y no se propaga el error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    convFindUnique.mockResolvedValue(SIN_DUENO);
    avisarHiloSinDueno.mockRejectedValue(new Error("boom"));
    await expect(escalateToHuman("conv-bbva", "x")).resolves.toBeUndefined();
    expect(convUpdate).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("escalateToHuman — con dueño, igual que siempre", () => {
  it("contacto con asesor: controlledById = asesor, aviso «El bot te pasó una conversación», sin camino nuevo", async () => {
    convFindUnique.mockResolvedValue({ ...SIN_DUENO, contact: { ...SIN_DUENO.contact, assignedToId: "u-asesor" } });
    await escalateToHuman("conv-bbva", "x");
    expect(convUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "HUMAN", controlledById: "u-asesor" }) }),
    );
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "u-asesor", title: "El bot te pasó una conversación", link: "/inbox?c=conv-bbva" }),
      }),
    );
    expect(avisarHiloSinDueno).not.toHaveBeenCalled();
  });

  it("routeToUserId (propuestas de marketing) gana aunque el contacto no tenga asesor", async () => {
    convFindUnique.mockResolvedValue(SIN_DUENO);
    await escalateToHuman("conv-bbva", "Propuesta comercial", { routeToUserId: "u-luis" });
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u-luis" }) }),
    );
    expect(avisarHiloSinDueno).not.toHaveBeenCalled();
  });
});

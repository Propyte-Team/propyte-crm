import { describe, it, expect, vi, beforeEach } from "vitest";

// 2026-10-12: la actividad de un SMS entrante se firmaba con «el asignado o cualquier ADMIN
// activo» (Audit Temp incluido). Ahora la firma la decide el helper común, que tiene sus
// propias pruebas; aquí solo importa que sms.ts le pregunte a él y que el AVISO siga yendo
// al asesor asignado, sea quien sea.

const messageCreate = vi.fn();
const activityCreate = vi.fn();
const notificationCreate = vi.fn();
vi.mock("@/lib/db", () => {
  const db = {
    message: { create: (...a: unknown[]) => messageCreate(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
  };
  return { prisma: db, default: db };
});

const findContactByPhone = vi.fn();
vi.mock("./utils", () => ({
  findContactByPhone: (...a: unknown[]) => findContactByPhone(...a),
  normalizePhone: (p: string) => p,
}));
vi.mock("./client", () => ({ getTwilioClient: vi.fn() }));

const resolveActorUserId = vi.fn();
vi.mock("@/lib/users/actor-sistema", () => ({
  resolveActorUserId: (...a: unknown[]) => resolveActorUserId(...a),
}));

import { handleInboundSMS } from "./sms";

const SMS = { From: "+5215550000", Body: "Hola", MessageSid: "SM1" };

beforeEach(() => {
  vi.clearAllMocks();
  messageCreate.mockResolvedValue({ id: "m1" });
  activityCreate.mockResolvedValue({});
  notificationCreate.mockResolvedValue({});
});

describe("handleInboundSMS — firma de la actividad", () => {
  it("asesor técnico: la actividad sale a nombre de quien devuelve el helper; el aviso sigue al asignado", async () => {
    findContactByPhone.mockResolvedValue({ id: "c1", assignedToId: "u-agentes", firstName: "Ana", lastName: "García" });
    resolveActorUserId.mockResolvedValue("u-admin");

    await handleInboundSMS(SMS);

    expect(resolveActorUserId).toHaveBeenCalledWith({ assignedToId: "u-agentes" });
    expect(activityCreate.mock.calls[0][0].data).toMatchObject({ userId: "u-admin", activityType: "SMS_IN" });
    expect(notificationCreate.mock.calls[0][0].data.userId).toBe("u-agentes");
    expect(messageCreate.mock.calls[0][0].data.userId).toBe("u-agentes");
  });

  it("sin nadie a quien atribuirla: se omite la actividad, el mensaje queda", async () => {
    findContactByPhone.mockResolvedValue({ id: "c1", assignedToId: null, firstName: "Ana", lastName: "García" });
    resolveActorUserId.mockResolvedValue(null);

    expect(await handleInboundSMS(SMS)).toEqual({ id: "m1" });
    expect(activityCreate).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("si el helper falla, el SMS se registra igual", async () => {
    findContactByPhone.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "Ana", lastName: "García" });
    resolveActorUserId.mockRejectedValue(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await handleInboundSMS(SMS)).toEqual({ id: "m1" });
    expect(activityCreate).not.toHaveBeenCalled();
    expect(notificationCreate).toHaveBeenCalled();
    error.mockRestore();
  });
});

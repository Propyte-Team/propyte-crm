import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindFirst = vi.fn();
const convFindFirst = vi.fn();
const convCreate = vi.fn();
const convUpdate = vi.fn();
const msgCreate = vi.fn();
const msgFindUnique = vi.fn();
const activityCreate = vi.fn();
const captureLead = vi.fn();
const botRespond = vi.fn();
const meetSlaTimers = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: { findFirst: (...a: unknown[]) => contactFindFirst(...a), findUnique: vi.fn(async () => ({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" })) },
    conversation: {
      findFirst: (...a: unknown[]) => convFindFirst(...a),
      create: (...a: unknown[]) => convCreate(...a),
      update: (...a: unknown[]) => convUpdate(...a),
    },
    message: { create: (...a: unknown[]) => msgCreate(...a), findUnique: (...a: unknown[]) => msgFindUnique(...a) },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
    notification: { create: vi.fn() },
  },
}));
vi.mock("@/lib/intake/capture-lead", () => ({ captureLead: (...a: unknown[]) => captureLead(...a) }));
vi.mock("@/lib/bot/bot-respond", () => ({ botRespond: (...a: unknown[]) => botRespond(...a) }));
vi.mock("@/lib/workflows/sla", () => ({ meetSlaTimers: (...a: unknown[]) => meetSlaTimers(...a) }));
const emitEvent = vi.fn();
vi.mock("@/lib/workflows/events", () => ({ emitEvent: (...a: unknown[]) => emitEvent(...a) }));

import { handleInboundMessage } from "./core";

beforeEach(() => {
  [contactFindFirst, convFindFirst, convCreate, convUpdate, msgCreate, msgFindUnique, activityCreate, captureLead, botRespond, meetSlaTimers, emitEvent].forEach((m) => m.mockReset());
  convFindFirst.mockResolvedValue({ id: "conv1", status: "BOT", botEnabled: true });
  convUpdate.mockResolvedValue({ id: "conv1", status: "BOT", botEnabled: true });
  msgCreate.mockResolvedValue({ id: "m1" });
  activityCreate.mockResolvedValue({});
});

const base = { channel: "INSTAGRAM" as const, senderId: "IG-1", externalMessageId: "mid-1", text: "hola", profileName: "Ana" };

describe("handleInboundMessage", () => {
  it("DM de desconocido → captureLead con source y id social", async () => {
    contactFindFirst.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: "c1", isNew: true, assignedToId: "u1" });
    await handleInboundMessage(base);
    expect(captureLead).toHaveBeenCalledWith(
      expect.objectContaining({ source: "INSTAGRAM", instagramId: "IG-1", firstName: "Ana" })
    );
    expect(convUpdate).toHaveBeenCalled();
    expect(msgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channel: "INSTAGRAM", direction: "INBOUND", externalMessageId: "mid-1" }) })
    );
    expect(activityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ activityType: "INSTAGRAM_IN" }) })
    );
  });

  it("contacto conocido por instagramId → no captura", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    await handleInboundMessage(base);
    expect(captureLead).not.toHaveBeenCalled();
  });

  it("reentrega con mismo externalMessageId → idempotente (no duplica)", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    msgCreate.mockRejectedValueOnce({ code: "P2002" });
    msgFindUnique.mockResolvedValue({ id: "m-existing" });
    const r = await handleInboundMessage(base);
    expect(msgFindUnique).toHaveBeenCalledWith({ where: { externalMessageId: "mid-1" } });
    expect(r).toEqual({ id: "m-existing" });
  });

  it("status BOT + botEnabled → botRespond con channel", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B" });
    await handleInboundMessage(base);
    expect(botRespond).toHaveBeenCalledWith("c1", { channel: "INSTAGRAM" });
  });
});

const wa = { channel: "WHATSAPP" as const, senderId: "+529991112233", externalMessageId: "wamid-1", text: "hola", profileName: "Ana" };

describe("handleInboundMessage – regresiones WhatsApp", () => {
  beforeEach(() => {
    convFindFirst.mockResolvedValue({ id: "conv1", status: "BOT", botEnabled: true });
    convUpdate.mockResolvedValue({ id: "conv1", status: "BOT", botEnabled: true });
    msgCreate.mockResolvedValue({ id: "m1" });
    activityCreate.mockResolvedValue({});
  });

  it("WHATSAPP: contacto con opt-out NO dispara el bot", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", whatsappOptOut: true });
    await handleInboundMessage(wa);
    expect(botRespond).not.toHaveBeenCalled();
  });

  it("WHATSAPP: contacto sin opt-out SÍ dispara el bot", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", whatsappOptOut: false });
    await handleInboundMessage(wa);
    expect(botRespond).toHaveBeenCalledWith("c1", { channel: "WHATSAPP" });
  });

  it("WHATSAPP: emite el evento whatsapp.replied (no-regresión)", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", whatsappOptOut: false });
    await handleInboundMessage(wa);
    expect(emitEvent).toHaveBeenCalledWith("whatsapp.replied", "conversation", "conv1", expect.objectContaining({ contactId: "c1" }));
  });

  it("WHATSAPP: busca contacto con match flexible (exact OR endsWith last10)", async () => {
    contactFindFirst.mockResolvedValue({ id: "c1", assignedToId: "u1", firstName: "A", lastName: "B", whatsappOptOut: false });
    await handleInboundMessage(wa);
    expect(contactFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: expect.arrayContaining([{ phone: "+529991112233" }]) }) })
    );
  });
});

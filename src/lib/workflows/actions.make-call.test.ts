import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted — factories cannot reference variables declared in the test file.
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: vi.fn() },
    deal: { findUnique: vi.fn() },
    activity: { create: vi.fn().mockResolvedValue({ id: "a1" }) },
    notification: { create: vi.fn().mockResolvedValue({ id: "n1" }) },
    user: { findFirst: vi.fn().mockResolvedValue({ id: "u1" }) },
  },
}));

import { executeAction } from "./actions";
import db from "@/lib/db";

const prisma = db as ReturnType<typeof vi.fn> & typeof db;

const contact = {
  id: "c1",
  phone: "+52155500",
  firstName: "Ana",
  doNotContact: false,
  assignedToId: "u1",
  tags: [],
  whatsappOptOut: false,
};

beforeEach(() => {
  (prisma.activity.create as ReturnType<typeof vi.fn>).mockClear();
  (prisma.notification.create as ReturnType<typeof vi.fn>).mockClear();
  (prisma.contact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(contact);
  (prisma.activity.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "a1" });
  (prisma.notification.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "n1" });
});

describe("MAKE_CALL runner", () => {
  it("crea una Activity CALL_TASK + Notification", async () => {
    const r = await executeAction({
      id: "q1",
      actionType: "MAKE_CALL",
      entityType: "contact",
      entityId: "c1",
      config: { reason: "Seguimiento" },
    } as never);
    expect(r.skipped).toBeUndefined();
    expect(prisma.activity.create).toHaveBeenCalledTimes(1);
    expect((prisma.activity.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.activityType).toBe("CALL_TASK");
    expect((prisma.activity.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.status).toBe("PENDIENTE");
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it("skip si el contacto no tiene teléfono", async () => {
    (prisma.contact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...contact, phone: null });
    const r = await executeAction({
      id: "q2",
      actionType: "MAKE_CALL",
      entityType: "contact",
      entityId: "c1",
      config: {},
    } as never);
    expect(r.skipped).toBe(true);
    expect(prisma.activity.create).not.toHaveBeenCalled();
  });

  it("skip si doNotContact", async () => {
    (prisma.contact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...contact, doNotContact: true });
    const r = await executeAction({
      id: "q3",
      actionType: "MAKE_CALL",
      entityType: "contact",
      entityId: "c1",
      config: {},
    } as never);
    expect(r.skipped).toBe(true);
  });

  it("skip si no hay usuario destino (sin asignado ni admin)", async () => {
    (prisma.contact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...contact, assignedToId: null });
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const r = await executeAction({
      id: "q4",
      actionType: "MAKE_CALL",
      entityType: "contact",
      entityId: "c1",
      config: {},
    } as never);
    expect(r.skipped).toBe(true);
    expect(prisma.activity.create).not.toHaveBeenCalled();
  });
});

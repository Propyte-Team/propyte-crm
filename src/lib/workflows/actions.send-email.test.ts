import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted — factories cannot reference variables declared in the test file.
// We use vi.fn() directly inside factories and grab them via importMock helpers below.

vi.mock("@/lib/google/gmail", () => ({
  sendGmail: vi.fn().mockResolvedValue({ messageId: "m1", threadId: "t1", from: "x@gmail.com" }),
}));
vi.mock("@/lib/email/mailer", () => ({
  sendSmtpEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/google/workspace.service", () => ({
  getConnectionStatus: vi.fn().mockResolvedValue({ connected: true }),
}));

// Prisma mock — the factory returns a plain object; we grab the reference after import.
vi.mock("@/lib/db", () => ({
  default: {
    contact: { findUnique: vi.fn() },
    deal: { findUnique: vi.fn() },
    userTemplate: { findFirst: vi.fn().mockResolvedValue(null) },
    userProfile: {
      findUnique: vi.fn().mockResolvedValue({ emailSignatureHtml: "— Firma" }),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue({ id: "u1" }),
      findUnique: vi.fn().mockResolvedValue({ name: "Ana Pérez" }),
    },
    activity: { create: vi.fn().mockResolvedValue({}) },
    notification: { create: vi.fn().mockResolvedValue({}) },
    conversation: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

import { executeAction } from "./actions";
import * as gmailModule from "@/lib/google/gmail";
import * as mailerModule from "@/lib/email/mailer";
import * as wsModule from "@/lib/google/workspace.service";
import db from "@/lib/db";

const sendGmail = vi.mocked(gmailModule.sendGmail);
const sendSmtpEmail = vi.mocked(mailerModule.sendSmtpEmail);
const getConnectionStatus = vi.mocked(wsModule.getConnectionStatus);
const prisma = db as ReturnType<typeof vi.fn> & typeof db;

const baseContact = {
  id: "c1",
  email: "ana@example.com",
  firstName: "Ana",
  lastName: "Pérez",
  doNotContact: false,
  preferredLanguage: "ES",
  assignedToId: "u1",
  tags: [],
  whatsappOptOut: false,
  lifecycleStage: "LEAD",
};

beforeEach(() => {
  sendGmail.mockClear();
  sendSmtpEmail.mockClear();
  getConnectionStatus.mockClear();
  (prisma.contact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(baseContact);
  (prisma.userTemplate.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (prisma.userProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ emailSignatureHtml: "— Firma" });
  (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
  (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ name: "Ana Pérez" });
  (prisma.activity.create as ReturnType<typeof vi.fn>).mockClear();
  sendGmail.mockResolvedValue({ messageId: "m1", threadId: "t1", from: "x@gmail.com" });
  sendSmtpEmail.mockResolvedValue(undefined);
});

describe("SEND_EMAIL runner", () => {
  it("routes to Gmail when owner has active connection", async () => {
    getConnectionStatus.mockResolvedValue({ connected: true });
    const r = await executeAction({
      id: "q1",
      actionType: "SEND_EMAIL",
      entityType: "contact",
      entityId: "c1",
      config: { subject: "Hola {{contact.firstName}}", body: "Este es el cuerpo del email." },
    } as never);
    expect(sendGmail).toHaveBeenCalledTimes(1);
    expect(sendGmail).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", to: "ana@example.com" }),
    );
    expect(sendSmtpEmail).not.toHaveBeenCalled();
    expect(r.skipped).toBeUndefined();
  });

  it("resolves {{contact.firstName}} in subject before sending via Gmail", async () => {
    getConnectionStatus.mockResolvedValue({ connected: true });
    await executeAction({
      id: "q2",
      actionType: "SEND_EMAIL",
      entityType: "contact",
      entityId: "c1",
      config: { subject: "Hola {{contact.firstName}}", body: "Cuerpo del mensaje." },
    } as never);
    const call = sendGmail.mock.calls[0][0];
    expect(call.subject).toBe("Hola Ana");
  });

  it("routes to SMTP + creates Activity when owner has no Gmail connection", async () => {
    getConnectionStatus.mockResolvedValue({ connected: false });
    const r = await executeAction({
      id: "q3",
      actionType: "SEND_EMAIL",
      entityType: "contact",
      entityId: "c1",
      config: { subject: "Seguimiento", body: "Cuerpo del email SMTP." },
    } as never);
    expect(sendSmtpEmail).toHaveBeenCalledTimes(1);
    expect(sendSmtpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ana@example.com", subject: "Seguimiento" }),
    );
    expect(prisma.activity.create).toHaveBeenCalledTimes(1);
    expect(prisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contactId: "c1",
          userId: "u1",
          activityType: "EMAIL_SENT",
          subject: "Seguimiento",
        }),
      }),
    );
    expect(r.skipped).toBeUndefined();
  });

  it("skips when contact has no email", async () => {
    (prisma.contact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseContact,
      email: null,
    });
    const r = await executeAction({
      id: "q4",
      actionType: "SEND_EMAIL",
      entityType: "contact",
      entityId: "c1",
      config: { subject: "Test", body: "Body" },
    } as never);
    expect(r.skipped).toBe(true);
    expect(sendGmail).not.toHaveBeenCalled();
    expect(sendSmtpEmail).not.toHaveBeenCalled();
  });

  it("skips when doNotContact is true", async () => {
    (prisma.contact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseContact,
      doNotContact: true,
    });
    const r = await executeAction({
      id: "q5",
      actionType: "SEND_EMAIL",
      entityType: "contact",
      entityId: "c1",
      config: { subject: "Test", body: "Body" },
    } as never);
    expect(r.skipped).toBe(true);
    expect(sendGmail).not.toHaveBeenCalled();
  });

  it("skips when neither template nor config subject/body provided", async () => {
    getConnectionStatus.mockResolvedValue({ connected: true });
    const r = await executeAction({
      id: "q6",
      actionType: "SEND_EMAIL",
      entityType: "contact",
      entityId: "c1",
      config: {},
    } as never);
    expect(r.skipped).toBe(true);
    expect(sendGmail).not.toHaveBeenCalled();
    expect(sendSmtpEmail).not.toHaveBeenCalled();
  });

  it("appends emailSignatureHtml to the sent html (SMTP path)", async () => {
    getConnectionStatus.mockResolvedValue({ connected: false });
    (prisma.userProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      emailSignatureHtml: '<div class="sig">— Firma Corporativa</div>',
    });
    await executeAction({
      id: "q7",
      actionType: "SEND_EMAIL",
      entityType: "contact",
      entityId: "c1",
      config: { subject: "Asunto", body: "Cuerpo sin firma." },
    } as never);
    const sent = sendSmtpEmail.mock.calls[0][0];
    expect(sent.html).toContain('<div class="sig">— Firma Corporativa</div>');
    // Activity.description guarda solo el texto del cuerpo (la firma es boilerplate)
    const act = (prisma.activity.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(act.data.description).toBe("Cuerpo sin firma.");
    expect(act.data.description).not.toContain("Firma Corporativa");
  });

  it("la firma HTML NO se escapa (llega con tags crudos)", async () => {
    getConnectionStatus.mockResolvedValue({ connected: true });
    (prisma.userProfile.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      emailSignatureHtml: '<div class="sig">— Ana</div>',
    });
    await executeAction({
      id: "q9",
      actionType: "SEND_EMAIL",
      entityType: "contact",
      entityId: "c1",
      config: { subject: "S", body: "Cuerpo" },
    } as never);
    const arg = sendGmail.mock.calls[0][0];
    expect(arg.html).toContain('<div class="sig">'); // crudo, no escapado
    expect(arg.html).not.toContain("&lt;div");
  });

  it("does not create Activity when SMTP send has no owner", async () => {
    getConnectionStatus.mockResolvedValue({ connected: false });
    (prisma.contact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseContact,
      assignedToId: null,
    });
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await executeAction({
      id: "q8",
      actionType: "SEND_EMAIL",
      entityType: "contact",
      entityId: "c1",
      config: { subject: "Sin dueño", body: "Mensaje de prueba." },
    } as never);
    expect(sendSmtpEmail).toHaveBeenCalledTimes(1);
    expect(prisma.activity.create).not.toHaveBeenCalled();
  });
});

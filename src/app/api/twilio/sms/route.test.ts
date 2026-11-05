import { describe, it, expect, vi, beforeEach } from "vitest";

// #833: mandar SMS a un contacto sin teléfono guardado responde un aviso claro (422) y no llega a
// Twilio. Y la ruta pasa a tener las mismas puertas que la de llamada: el contacto tiene que estar
// al alcance de quien envía, y «No contactar» se respeta.

const contactFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) } } }));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const puedeTocarRecord = vi.fn();
vi.mock("@/lib/rbac/record-access", () => ({ puedeTocarRecord: (...a: unknown[]) => puedeTocarRecord(...a) }));

// Lo que haría Twilio con un número vacío: rechazarlo.
const sendSMS = vi.fn();
vi.mock("@/lib/twilio/sms", () => ({ sendSMS: (...a: unknown[]) => sendSMS(...a) }));

import { POST } from "./route";
import { MENSAJE_SIN_TELEFONO } from "@/lib/contacts/sin-telefono";

const enviar = () =>
  POST(
    new Request("https://x/api/twilio/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: "c1", body: "Hola" }),
    }) as never,
  );

beforeEach(() => {
  for (const m of [contactFindUnique, getServerSession, puedeTocarRecord, sendSMS]) m.mockReset();
  getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR" } });
  puedeTocarRecord.mockResolvedValue(true);
  sendSMS.mockImplementation(async (to: string) => {
    if (!to) throw new Error("A 'To' phone number is required.");
    return { sid: "SM1" };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/twilio/sms (#833)", () => {
  it.each(["", "   "])("teléfono %j: 422 con el aviso, y no se manda nada", async (phone) => {
    contactFindUnique.mockResolvedValue({ phone, doNotContact: false });
    const res = await enviar();
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(MENSAJE_SIN_TELEFONO);
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it("con teléfono, el SMS sale como antes", async () => {
    contactFindUnique.mockResolvedValue({ phone: "+529841234567", doNotContact: false });
    const res = await enviar();
    expect(res.status).toBe(200);
    expect(sendSMS).toHaveBeenCalledWith("+529841234567", "Hola", "c1", "ase-1");
  });

  it("contacto que no le toca a quien envía: 404 y no se manda nada", async () => {
    contactFindUnique.mockResolvedValue({ phone: "+529841234567", doNotContact: false });
    puedeTocarRecord.mockResolvedValue(false);
    expect((await enviar()).status).toBe(404);
    expect(puedeTocarRecord).toHaveBeenCalledWith("contact", "c1", expect.objectContaining({ id: "ase-1" }), "editar");
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it("contacto marcado «No contactar»: 422 y no se manda nada", async () => {
    contactFindUnique.mockResolvedValue({ phone: "+529841234567", doNotContact: true });
    expect((await enviar()).status).toBe(422);
    expect(sendSMS).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// #833: llamar a un contacto sin teléfono guardado responde un aviso claro (422) y no llega a
// Twilio. Antes Twilio rechazaba el número vacío y la ruta devolvía un 500 genérico.

const contactFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) } } }));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const puedeTocarRecord = vi.fn();
vi.mock("@/lib/rbac/record-access", () => ({ puedeTocarRecord: (...a: unknown[]) => puedeTocarRecord(...a) }));

// Lo que haría Twilio con un número vacío: rechazarlo.
const initiateCall = vi.fn();
vi.mock("@/lib/twilio/voice", () => ({ initiateCall: (...a: unknown[]) => initiateCall(...a) }));

import { POST } from "./route";
import { MENSAJE_SIN_TELEFONO } from "@/lib/contacts/sin-telefono";

const llamar = () =>
  POST(
    new Request("https://x/api/twilio/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: "c1" }),
    }) as never,
  );

beforeEach(() => {
  for (const m of [contactFindUnique, getServerSession, puedeTocarRecord, initiateCall]) m.mockReset();
  getServerSession.mockResolvedValue({ user: { id: "ase-1", role: "ASESOR" } });
  puedeTocarRecord.mockResolvedValue(true);
  initiateCall.mockImplementation(async (to: string) => {
    if (!to) throw new Error("A 'To' phone number is required.");
    return { callSid: "CA1" };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/twilio/call — contacto sin teléfono (#833)", () => {
  it.each(["", "   "])("teléfono %j: 422 con el aviso, y no se llama a Twilio", async (phone) => {
    contactFindUnique.mockResolvedValue({ phone, firstName: "Ana", lastName: "L", doNotContact: false });
    const res = await llamar();
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(MENSAJE_SIN_TELEFONO);
    expect(initiateCall).not.toHaveBeenCalled();
  });

  it("con teléfono, la llamada sale como antes", async () => {
    contactFindUnique.mockResolvedValue({ phone: "+529841234567", firstName: "Ana", lastName: "L", doNotContact: false });
    const res = await llamar();
    expect(res.status).toBe(200);
    expect(initiateCall).toHaveBeenCalledWith("+529841234567", "ase-1", "c1");
  });

  it("el acceso al contacto se sigue comprobando antes: ajeno → 404", async () => {
    contactFindUnique.mockResolvedValue({ phone: "", firstName: "Ana", lastName: "L", doNotContact: false });
    puedeTocarRecord.mockResolvedValue(false);
    expect((await llamar()).status).toBe(404);
  });
});

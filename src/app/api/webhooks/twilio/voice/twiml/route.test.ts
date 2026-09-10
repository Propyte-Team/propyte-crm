import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();
const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { activity: { create: (...a: unknown[]) => create(...a) }, contact: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
vi.mock("@/lib/twilio/client", () => ({ validateTwilioSignature: vi.fn(async () => true) }));

import { POST } from "./route";

function formReq(fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString();
  return new Request("https://crm.propyte.com/api/webhooks/twilio/voice/twiml", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  }) as unknown as import("next/server").NextRequest;
}

// Auditoría 2026-09-10: el mock del contacto ahora incluye `phone`, porque el número a
// marcar sale de la BASE y ya no de `params.To`. Ver el bloque de comentario del route.
const TEL = "+529991112233";
beforeEach(() => { create.mockReset(); findUnique.mockReset(); create.mockResolvedValue({ id: "a1" }); findUnique.mockResolvedValue({ phone: TEL, preferredLanguage: "ES", doNotContact: false }); });

describe("voice/twiml (salida)", () => {
  it("crea Activity CALL_OUTBOUND con callSid+contactId y devuelve TwiML con Dial+record", async () => {
    const res = await POST(formReq({ CallSid: "CA1", To: TEL, contactId: "c1", userId: "u1" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ activityType: "CALL_OUTBOUND", callSid: "CA1", contactId: "c1", userId: "u1", status: "PENDIENTE" }) }));
    const xml = await res.text();
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(xml).toContain("<Dial");
    expect(xml).toContain('record="record-from-answer-dual"');
    expect(xml).toContain("dial-action-outbound");
    expect(xml).toContain(TEL);
  });
  it("teléfono del contacto ilegible → TwiML de error sin crear Activity", async () => {
    findUnique.mockResolvedValue({ phone: "abc", preferredLanguage: "ES", doNotContact: false });
    const res = await POST(formReq({ CallSid: "CA1", contactId: "c1", userId: "u1" }));
    const xml = await res.text();
    expect(xml).toContain("inválido");
    expect(create).not.toHaveBeenCalled();
  });
  it("doNotContact → Hangup sin Activity", async () => {
    findUnique.mockResolvedValue({ phone: TEL, preferredLanguage: "ES", doNotContact: true });
    const res = await POST(formReq({ CallSid: "CA1", To: TEL, contactId: "c1", userId: "u1" }));
    const xml = await res.text();
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("<Dial");
    expect(create).not.toHaveBeenCalled();
  });
  it("firma inválida → 403", async () => {
    const { validateTwilioSignature } = await import("@/lib/twilio/client");
    (validateTwilioSignature as unknown as { mockResolvedValueOnce: (v: boolean) => void }).mockResolvedValueOnce(false);
    const res = await POST(formReq({ CallSid: "CA1", To: "+52999", contactId: "c1", userId: "u1" }));
    expect(res.status).toBe(403);
  });
});

// Auditoría 2026-09-10: los dos agujeros que cierra el que el número lo ponga el servidor.
describe("voice/twiml — el número lo decide el servidor, no el navegador", () => {
  it("🚨 sin contactId NO se marca: era el bypass de doNotContact", async () => {
    // Omitir contactId dejaba la comprobación de no-contactar dentro de un `if` que no se
    // entraba, y se marcaba el `To` que viniera. Ahora contactId es obligatorio.
    const res = await POST(formReq({ CallSid: "CA1", To: TEL, userId: "u1" }));
    const xml = await res.text();
    expect(xml).toContain("<Hangup");
    expect(xml).not.toContain("<Dial");
    expect(create).not.toHaveBeenCalled();
    // Y no llegó a consultar la base: cortó antes.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("🚨 el `To` del navegador se IGNORA — se marca el teléfono del contacto", async () => {
    // Aquí estaba el fraude de tarificación: cualquier número que pasara el regex se
    // marcaba a cargo de la cuenta Twilio de la empresa. Un número de tarifa especial
    // en `To` ahora no aparece en el TwiML.
    const PREMIUM = "+2345678901";
    const res = await POST(formReq({ CallSid: "CA1", To: PREMIUM, contactId: "c1", userId: "u1" }));
    const xml = await res.text();
    expect(xml).not.toContain(PREMIUM);
    expect(xml).toContain(TEL);
  });

  it("contacto inexistente → Hangup sin Activity", async () => {
    findUnique.mockResolvedValue(null);
    const res = await POST(formReq({ CallSid: "CA1", contactId: "no-existe", userId: "u1" }));
    const xml = await res.text();
    expect(xml).toContain("<Hangup");
    expect(create).not.toHaveBeenCalled();
  });
});

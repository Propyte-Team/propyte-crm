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

beforeEach(() => { create.mockReset(); findUnique.mockReset(); create.mockResolvedValue({ id: "a1" }); findUnique.mockResolvedValue({ preferredLanguage: "ES" }); });

describe("voice/twiml (salida)", () => {
  it("crea Activity CALL_OUTBOUND con callSid+contactId y devuelve TwiML con Dial+record", async () => {
    const res = await POST(formReq({ CallSid: "CA1", To: "+529991112233", contactId: "c1", userId: "u1" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ activityType: "CALL_OUTBOUND", callSid: "CA1", contactId: "c1", userId: "u1", status: "PENDIENTE" }) }));
    const xml = await res.text();
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(xml).toContain("<Dial");
    expect(xml).toContain('record="record-from-answer-dual"');
    expect(xml).toContain("+529991112233");
  });
  it("número inválido → TwiML de error sin crear Activity", async () => {
    const res = await POST(formReq({ CallSid: "CA1", To: "abc", contactId: "c1", userId: "u1" }));
    const xml = await res.text();
    expect(xml).toContain("inválido");
    expect(create).not.toHaveBeenCalled();
  });
  it("firma inválida → 403", async () => {
    const { validateTwilioSignature } = await import("@/lib/twilio/client");
    (validateTwilioSignature as unknown as { mockResolvedValueOnce: (v: boolean) => void }).mockResolvedValueOnce(false);
    const res = await POST(formReq({ CallSid: "CA1", To: "+52999", contactId: "c1", userId: "u1" }));
    expect(res.status).toBe(403);
  });
});

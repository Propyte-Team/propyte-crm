import { describe, it, expect, vi, beforeEach } from "vitest";
const findContactByPhone = vi.fn();
const captureLead = vi.fn();
const create = vi.fn();
vi.mock("@/lib/twilio/utils", () => ({ findContactByPhone: (...a: unknown[]) => findContactByPhone(...a) }));
vi.mock("@/lib/intake/capture-lead", () => ({ captureLead: (...a: unknown[]) => captureLead(...a) }));
vi.mock("@/lib/db", () => ({ prisma: { activity: { create: (...a: unknown[]) => create(...a) } } }));
vi.mock("@/lib/twilio/client", () => ({ validateTwilioSignature: vi.fn(async () => true) }));
import { POST } from "./route";
function formReq(fields: Record<string, string>) {
  return new Request("https://crm.propyte.com/api/webhooks/twilio/voice/incoming", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString(),
  }) as unknown as import("next/server").NextRequest;
}
beforeEach(() => { [findContactByPhone, captureLead, create].forEach(m => m.mockReset()); create.mockResolvedValue({ id: "a1" }); });

describe("voice/incoming", () => {
  it("contacto conocido con asesor → Dial al Client del asesor + crea Activity CALL_INBOUND; sin buzón en este TwiML", async () => {
    findContactByPhone.mockResolvedValue({ id: "c1", assignedToId: "u1" });
    const res = await POST(formReq({ CallSid: "CA9", From: "+529991112233", To: "+52..." }));
    const xml = await res.text();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activityType: "CALL_INBOUND",
          callSid: "CA9",
          contactId: "c1",
          userId: "u1",
        }),
      })
    );
    expect(xml).toContain("<Client>u1</Client>");
    expect(xml).toContain("dial-action");
    expect(xml).not.toContain("<Record");
  });
  it("desconocido → captureLead LLAMADA_ENTRANTE y va a buzón si no hay asesor; NO crea Activity", async () => {
    findContactByPhone.mockResolvedValue(null);
    captureLead.mockResolvedValue({ contactId: "c2", assignedToId: null });
    const res = await POST(formReq({ CallSid: "CA10", From: "+521000000000", To: "+52..." }));
    const xml = await res.text();
    expect(captureLead).toHaveBeenCalledWith(expect.objectContaining({ source: "LLAMADA_ENTRANTE", phone: "+521000000000" }));
    expect(xml).toContain("<Record");
    expect(create).not.toHaveBeenCalled();
  });
  it("firma inválida → 403", async () => {
    const { validateTwilioSignature } = await import("@/lib/twilio/client");
    (validateTwilioSignature as unknown as { mockResolvedValueOnce: (v: boolean) => void }).mockResolvedValueOnce(false);
    const res = await POST(formReq({ CallSid: "CA9", From: "+52", To: "+52" }));
    expect(res.status).toBe(403);
  });
});

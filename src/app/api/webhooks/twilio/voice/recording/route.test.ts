import { describe, it, expect, vi, beforeEach } from "vitest";
const handleRecording = vi.fn();
vi.mock("@/lib/twilio/voice", () => ({ handleRecording: (...a: unknown[]) => handleRecording(...a) }));
vi.mock("@/lib/twilio/client", () => ({ validateTwilioSignature: vi.fn(async () => true) }));
import { POST } from "./route";
function formReq(fields: Record<string, string>) {
  return new Request("https://crm.propyte.com/api/webhooks/twilio/voice/recording", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString(),
  }) as unknown as import("next/server").NextRequest;
}
beforeEach(() => handleRecording.mockReset());
describe("voice/recording", () => {
  it("pasa CallSid + RecordingUrl al handler", async () => {
    const res = await POST(formReq({ CallSid: "CA1", RecordingUrl: "https://api.twilio.com/rec/abc" }));
    expect(res.status).toBe(200);
    expect(handleRecording).toHaveBeenCalledWith({ CallSid: "CA1", RecordingUrl: "https://api.twilio.com/rec/abc" });
  });
  it("firma inválida → 403", async () => {
    const { validateTwilioSignature } = await import("@/lib/twilio/client");
    (validateTwilioSignature as unknown as { mockResolvedValueOnce: (v: boolean) => void }).mockResolvedValueOnce(false);
    const res = await POST(formReq({ CallSid: "CA1", RecordingUrl: "x" }));
    expect(res.status).toBe(403);
    expect(handleRecording).not.toHaveBeenCalled();
  });
});

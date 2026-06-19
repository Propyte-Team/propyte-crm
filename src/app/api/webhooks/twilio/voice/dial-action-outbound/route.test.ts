import { describe, it, expect, vi, beforeEach } from "vitest";

const handleCallStatus = vi.fn();
vi.mock("@/lib/twilio/voice", () => ({
  handleCallStatus: (...a: unknown[]) => handleCallStatus(...a),
}));
vi.mock("@/lib/twilio/client", () => ({
  validateTwilioSignature: vi.fn(async () => true),
}));

import { POST } from "./route";

function formReq(fields: Record<string, string>) {
  return new Request(
    "https://crm.propyte.com/api/webhooks/twilio/voice/dial-action-outbound",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }
  ) as unknown as import("next/server").NextRequest;
}

beforeEach(() => handleCallStatus.mockReset());

describe("voice/dial-action-outbound", () => {
  it("completa la Activity vía handleCallStatus con el CallSid padre + DialCallStatus", async () => {
    const res = await POST(
      formReq({ CallSid: "CA-parent", DialCallStatus: "completed", DialCallDuration: "90" })
    );
    expect(res.status).toBe(200);
    expect(handleCallStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        CallSid: "CA-parent",
        CallStatus: "completed",
        CallDuration: "90",
      })
    );
    const body = await res.text();
    expect(body).toContain("<Response/>");
    expect(res.headers.get("content-type")).toContain("text/xml");
  });

  it("firma inválida → 403", async () => {
    const { validateTwilioSignature } = await import("@/lib/twilio/client");
    (
      validateTwilioSignature as unknown as {
        mockResolvedValueOnce: (v: boolean) => void;
      }
    ).mockResolvedValueOnce(false);
    const res = await POST(formReq({ CallSid: "CA1", DialCallStatus: "completed" }));
    expect(res.status).toBe(403);
  });

  it("omite handleCallStatus si faltan parámetros requeridos", async () => {
    const res = await POST(formReq({ CallSid: "CA1" })); // sin DialCallStatus
    expect(res.status).toBe(200);
    expect(handleCallStatus).not.toHaveBeenCalled();
  });
});

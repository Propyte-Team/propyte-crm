import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const update = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { activity: { findFirst: (...a: unknown[]) => findFirst(...a), update: (...a: unknown[]) => update(...a) } } }));

import { handleCallStatus, handleRecording } from "./voice";

beforeEach(() => { findFirst.mockReset(); update.mockReset(); findFirst.mockResolvedValue({ id: "a1", outcome: null }); update.mockResolvedValue({}); });

describe("handleCallStatus", () => {
  it("localiza la Activity por callSid y completa duración + status", async () => {
    await handleCallStatus({ CallSid: "CA1", CallStatus: "completed", CallDuration: "125", From: "+52", To: "+52" });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ callSid: "CA1" }) }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETADA", duration_minutes: 3 }) }));
  });
  it("no-answer fija outcome 'No contestó'", async () => {
    await handleCallStatus({ CallSid: "CA2", CallStatus: "no-answer", From: "+52", To: "+52" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ outcome: "No contestó" }) }));
  });
  it("completed NO sobreescribe un outcome ya elegido por el asesor", async () => {
    findFirst.mockResolvedValue({ id: "a1", outcome: "Agendó" });
    await handleCallStatus({ CallSid: "CA3", CallStatus: "completed", CallDuration: "60", From: "+52", To: "+52" });
    const arg = update.mock.calls[0][0].data;
    expect(arg.outcome).toBeUndefined();
  });
  it("estado no-final (ringing) no actualiza", async () => {
    await handleCallStatus({ CallSid: "CA4", CallStatus: "ringing", From: "+52", To: "+52" });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("handleRecording", () => {
  it("guarda recordingUrl por callSid (añade .mp3 si falta)", async () => {
    await handleRecording({ CallSid: "CA1", RecordingUrl: "https://api.twilio.com/rec/abc" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a1" }, data: { recordingUrl: "https://api.twilio.com/rec/abc.mp3" } }));
  });
});

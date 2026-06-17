import { describe, it, expect } from "vitest";
import { requiresMeetingGate, meetingStageMode } from "./meeting-gate";

describe("requiresMeetingGate", () => {
  it("true para etapas de reunión, false para el resto", () => {
    expect(requiresMeetingGate("MEETING_SCHEDULED")).toBe(true);
    expect(requiresMeetingGate("MEETING_COMPLETED")).toBe(true);
    expect(requiresMeetingGate("WON")).toBe(false);
    expect(requiresMeetingGate("NEW_LEAD")).toBe(false);
  });
});

describe("meetingStageMode", () => {
  it("mapea cada etapa de reunión a su modo", () => {
    expect(meetingStageMode("MEETING_SCHEDULED")).toBe("schedule");
    expect(meetingStageMode("MEETING_COMPLETED")).toBe("complete");
    expect(meetingStageMode("WON")).toBeNull();
  });
});

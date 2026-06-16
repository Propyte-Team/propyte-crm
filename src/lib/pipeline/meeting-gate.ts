// Gate de reunión: qué etapas obligan a registrar reunión y en qué modo.
export function requiresMeetingGate(stage: string): boolean {
  return stage === "MEETING_SCHEDULED" || stage === "MEETING_COMPLETED";
}

export function meetingStageMode(stage: string): "schedule" | "complete" | null {
  if (stage === "MEETING_SCHEDULED") return "schedule";
  if (stage === "MEETING_COMPLETED") return "complete";
  return null;
}

export const MEETING_ACTIVITY_TYPES = [
  { value: "MEETING_VIRTUAL", label: "Virtual" },
  { value: "MEETING_PRESENTIAL", label: "Presencial" },
  { value: "MEETING_SHOWROOM", label: "Showroom" },
] as const;

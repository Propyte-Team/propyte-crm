/** Resultados canónicos de una llamada (picklist en el log). */
export const CALL_OUTCOMES = ["Contestó", "No contestó", "Buzón", "Agendó", "No interesó"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** Mapea un CallStatus de Twilio (no contestado) a un outcome canónico. */
export function statusToOutcome(callStatus: string): CallOutcome | null {
  switch (callStatus) {
    case "no-answer": return "No contestó";
    case "busy": return "No contestó";
    case "failed": return "No contestó";
    case "completed": return null; // lo elige el asesor
    default: return null;
  }
}

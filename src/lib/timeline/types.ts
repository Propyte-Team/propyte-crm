// Tipo unificado de un evento de la cronología de un contacto (o deal, a futuro).
// Todas las fuentes (RecordFieldChange, Activity, Message, ActionPlanEnrollment,
// contact.createdAt) se normalizan a esta forma antes de mergear/paginar.
export type TimelineItemKind =
  | "field_change"
  | "activity"
  | "message"
  | "enrollment"
  | "created";

export interface TimelineItem {
  id: string;
  ts: string; // ISO 8601
  kind: TimelineItemKind;
  title: string;
  detail?: string;
  actorName?: string;
  source?: string;
  meta?: Record<string, unknown>;
}

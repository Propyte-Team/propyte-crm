// Plantillas de regla ("recetas") para el builder. Pre-llenan el form (editables).
// Segmentan por campaña (adAttribution.campaignName) → tipo/fuente/asignación/tag.
export interface RuleTemplate {
  key: "lead" | "broker" | "empleo";
  label: string;
  description: string;
  rule: {
    name: string;
    description: string;
    triggerType: "EVENT";
    triggerConfig: Record<string, unknown>;
    conditions: Record<string, unknown>;
    actions: { type: string; config: Record<string, unknown>; delayMinutes?: number }[];
  };
}

function tpl(key: RuleTemplate["key"], label: string, marker: string, contactType: string, leadSource: string, tag: string): RuleTemplate {
  return {
    key,
    label,
    description: `Lead cuya campaña contiene "${marker}" → tipo ${contactType}, fuente ${leadSource}, asignar y etiquetar.`,
    rule: {
      name: `${label} por campaña`,
      description: `Segmenta por campaña ${marker} (editar antes de guardar).`,
      triggerType: "EVENT",
      triggerConfig: { eventType: "lead.captured" },
      conditions: { all: [{ field: "adAttribution.campaignName", op: "contains", value: marker }] },
      actions: [
        { type: "UPDATE_FIELD", config: { field: "contactType", value: contactType } },
        { type: "UPDATE_FIELD", config: { field: "leadSource", value: leadSource } },
        { type: "ASSIGN", config: { strategy: "round_robin" } },
        { type: "ADD_TAG", config: { tag } },
      ],
    },
  };
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  tpl("lead", "Lead", "[LEADS]", "LEAD", "META_ADS", "lead"),
  tpl("broker", "Broker", "BROKER", "BROKER_EXTERNO", "REGISTRO_BROKER", "broker"),
  tpl("empleo", "Empleo", "EMPLEO", "EMPLEO", "META_ADS", "empleo"),
];

// Mapper puro Meta→Contact configurable por conector. Sin BD.
export interface MappingRule {
  source: "question" | "metadata" | "constant";
  metaField?: string;
  target: string;
  value?: string;
  valueMap?: Record<string, string>;
  fallback?: "omit" | "passthrough" | "fixed";
  fallbackValue?: string;
}

// Defaults de nombres de campo comunes de Meta Lead Ads (equivalen al viejo defaultMap del webhook).
// Se anteponen a las reglas del conector; las reglas del conector ganan por-target (van después).
export const DEFAULT_META_RULES: MappingRule[] = [
  { source: "question", metaField: "full_name", target: "fullName" },
  { source: "question", metaField: "name", target: "fullName" },
  { source: "question", metaField: "first_name", target: "firstName" },
  { source: "question", metaField: "last_name", target: "lastName" },
  { source: "question", metaField: "phone_number", target: "phone" },
  { source: "question", metaField: "phone", target: "phone" },
  { source: "question", metaField: "email", target: "email" },
];

// Normaliza el fieldMap almacenado (shape nuevo {rules} | shape viejo Record<string,string>) a reglas.
export function parseRules(fieldMap: unknown): MappingRule[] {
  if (fieldMap && typeof fieldMap === "object" && Array.isArray((fieldMap as { rules?: unknown }).rules)) {
    return (fieldMap as { rules: MappingRule[] }).rules;
  }
  if (fieldMap && typeof fieldMap === "object") {
    return Object.entries(fieldMap as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string")
      .map(([metaField, target]) => ({ source: "question" as const, metaField, target: target as string }));
  }
  return [];
}

function rawValue(rule: MappingRule, input: { fieldData: Record<string, unknown>; metadata: Record<string, unknown> }): unknown {
  if (rule.source === "constant") return rule.value;
  const src = rule.source === "metadata" ? input.metadata : input.fieldData;
  return rule.metaField ? src[rule.metaField] : undefined;
}

function applyValueMap(rule: MappingRule, value: string): string | undefined {
  const vm = rule.valueMap;
  // GOTCHA: {} es truthy → sin la guarda de length omitiría todo. Mapa vacío = passthrough.
  if (!vm || Object.keys(vm).length === 0) return value;
  if (value in vm) return vm[value];
  switch (rule.fallback) {
    case "passthrough": return value;
    case "fixed": return rule.fallbackValue;
    case "omit": default: return undefined;
  }
}

export function mapLead(
  rules: MappingRule[],
  input: { fieldData: Record<string, unknown>; metadata: Record<string, unknown> }
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rule of rules) {
    if (!rule.target) continue;
    let v = rawValue(rule, input);
    if (typeof v === "string") v = v.trim();
    if (v == null || v === "") continue; // constant con value vacío también se omite
    let str = String(v);
    const mapped = applyValueMap(rule, str);
    if (mapped == null) continue;
    str = mapped;
    if (rule.target === "fullName") {
      const parts = str.split(/\s+/);
      out.firstName = parts[0];
      out.lastName = parts.slice(1).join(" ") || "(sin apellido)";
    } else {
      out[rule.target] = str;
    }
  }
  return out;
}

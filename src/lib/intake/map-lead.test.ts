import { describe, it, expect } from "vitest";
import { mapLead, parseRules, DEFAULT_META_RULES, type MappingRule } from "./map-lead";

const input = {
  fieldData: { full_name: "Ana Gómez", email: "a@x.com", "¿presupuesto?": "2mdp", platform_q: "fb" },
  metadata: { campaign_name: "77 - PDC", campaign_id: "123", ad_name: "Ad A" },
};

describe("mapLead", () => {
  it("question → campo; fullName se parte", () => {
    const rules: MappingRule[] = [{ source: "question", metaField: "full_name", target: "fullName" }];
    expect(mapLead(rules, input)).toEqual({ firstName: "Ana", lastName: "Gómez" });
  });
  it("metadata → campo", () => {
    const rules: MappingRule[] = [{ source: "metadata", metaField: "campaign_name", target: "sourceDetail" }];
    expect(mapLead(rules, input)).toEqual({ sourceDetail: "77 - PDC" });
  });
  it("constant → valor fijo", () => {
    const rules: MappingRule[] = [{ source: "constant", value: "META_ADS", target: "source" }];
    expect(mapLead(rules, input)).toEqual({ source: "META_ADS" });
  });
  it("valueMap traduce y aplica; passthrough si mapa vacío (GOTCHA)", () => {
    const tr: MappingRule[] = [{ source: "question", metaField: "platform_q", target: "custom.plat", valueMap: { fb: "Facebook" } }];
    expect(mapLead(tr, input)).toEqual({ "custom.plat": "Facebook" });
    const empty: MappingRule[] = [{ source: "question", metaField: "platform_q", target: "custom.plat", valueMap: {} }];
    expect(mapLead(empty, input)).toEqual({ "custom.plat": "fb" }); // {} = passthrough, NO omite
  });
  it("valueMap sin match → fallback", () => {
    const omit: MappingRule[] = [{ source: "question", metaField: "platform_q", target: "custom.p", valueMap: { ig: "IG" }, fallback: "omit" }];
    expect(mapLead(omit, input)).toEqual({});
    const pass: MappingRule[] = [{ source: "question", metaField: "platform_q", target: "custom.p", valueMap: { ig: "IG" }, fallback: "passthrough" }];
    expect(mapLead(pass, input)).toEqual({ "custom.p": "fb" });
    const fixed: MappingRule[] = [{ source: "question", metaField: "platform_q", target: "custom.p", valueMap: { ig: "IG" }, fallback: "fixed", fallbackValue: "OTRO" }];
    expect(mapLead(fixed, input)).toEqual({ "custom.p": "OTRO" });
  });
  it("omite vacíos (question), constant siempre", () => {
    const r: MappingRule[] = [{ source: "question", metaField: "ausente", target: "email" }, { source: "constant", value: "x", target: "notes" }];
    expect(mapLead(r, input)).toEqual({ notes: "x" });
  });
});

describe("DEFAULT_META_RULES (defaults Meta)", () => {
  it("fieldMap vacío sigue capturando nombre/tel/email", () => {
    const fd = { full_name: "Ana Gómez", phone_number: "+52 1 999", email: "a@x.com" };
    const r = mapLead([...DEFAULT_META_RULES, ...parseRules({})], { fieldData: fd, metadata: {} });
    expect(r).toEqual({ firstName: "Ana", lastName: "Gómez", phone: "+52 1 999", email: "a@x.com" });
  });
  it("regla del conector gana por-target sobre el default", () => {
    const fd = { full_name: "Ana Gómez", correo_alt: "alt@x.com", email: "a@x.com" };
    const rules: MappingRule[] = [{ source: "question", metaField: "correo_alt", target: "email" }];
    const r = mapLead([...DEFAULT_META_RULES, ...rules], { fieldData: fd, metadata: {} });
    expect(r.email).toBe("alt@x.com"); // la regla del conector (después) gana
  });
});

describe("parseRules (retrocompat)", () => {
  it("shape nuevo {rules}", () => {
    const r = parseRules({ rules: [{ source: "constant", value: "v", target: "source" }] });
    expect(r).toHaveLength(1);
  });
  it("shape viejo Record<string,string> → question rules", () => {
    expect(parseRules({ full_name: "fullName", phone_number: "phone" })).toEqual([
      { source: "question", metaField: "full_name", target: "fullName" },
      { source: "question", metaField: "phone_number", target: "phone" },
    ]);
  });
  it("{} → []", () => { expect(parseRules({})).toEqual([]); });
});

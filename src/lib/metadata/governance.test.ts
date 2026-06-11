import { describe, it, expect } from "vitest";
import { validateApiName, findSimilarFields } from "./governance";

describe("validateApiName (PC2, anti-sprawl)", () => {
  it("acepta convención <obj>_<snake>", () => {
    expect(validateApiName("contact", "contact_referido_por").ok).toBe(true);
    expect(validateApiName("deal", "deal_notaria_numero").ok).toBe(true);
  });
  it("rechaza sin prefijo del objeto", () => {
    expect(validateApiName("contact", "referido_por").ok).toBe(false);
  });
  it("rechaza camelCase, espacios y mayúsculas", () => {
    expect(validateApiName("contact", "contact_ReferidoPor").ok).toBe(false);
    expect(validateApiName("contact", "contact referido").ok).toBe(false);
  });
  it("rechaza nombres reservados", () => {
    expect(validateApiName("contact", "contact_id").ok).toBe(false);
    expect(validateApiName("contact", "contact_custom").ok).toBe(false);
  });
});

describe("findSimilarFields (detector de duplicados semánticos)", () => {
  const existing = [
    { apiName: "contact_lead_source", label: "Fuente del lead" },
    { apiName: "contact_campaign_source", label: "Fuente de campaña" },
    { apiName: "contact_notaria", label: "Notaría" },
  ];
  it("detecta solapamiento por tokens del apiName", () => {
    const hits = findSimilarFields("contact_source_detail", "Detalle de fuente", existing);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].apiName).toContain("source");
  });
  it("detecta por label similar", () => {
    const hits = findSimilarFields("contact_origen", "Fuente del Lead", existing);
    expect(hits.some((h) => h.apiName === "contact_lead_source")).toBe(true);
  });
  it("sin parecido → vacío", () => {
    expect(findSimilarFields("contact_rfc_validado", "RFC validado", existing)).toHaveLength(0);
  });
});

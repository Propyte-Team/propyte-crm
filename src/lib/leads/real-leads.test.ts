import { describe, it, expect } from "vitest";
import { realLeadWhere, PROVISIONAL_COMMENT_LEAD } from "./real-leads";

describe("realLeadWhere", () => {
  it("conserva intacto el filtro que recibe", () => {
    const base = { deletedAt: null, createdAt: { gte: new Date("2026-08-01") } };
    const out = realLeadWhere(base);
    expect(out.deletedAt).toBeNull();
    expect(out.createdAt).toEqual({ gte: new Date("2026-08-01") });
  });

  it("agrega la exclusión de provisionales", () => {
    expect(realLeadWhere({}).NOT).toEqual(PROVISIONAL_COMMENT_LEAD);
  });

  it("no pisa un NOT que ya viniera en el filtro: los combina", () => {
    const out = realLeadWhere({ NOT: { email: null } });
    expect(out.NOT).toEqual([{ email: null }, PROVISIONAL_COMMENT_LEAD]);
  });

  it("respeta un NOT que ya fuera arreglo", () => {
    const out = realLeadWhere({ NOT: [{ email: null }, { phone: "" }] });
    expect(out.NOT).toEqual([{ email: null }, { phone: "" }, PROVISIONAL_COMMENT_LEAD]);
  });

  it("las dos condiciones del provisional van en UN solo objeto negado", () => {
    // NOT: { a, b } niega (a Y b) — el provisional que sí contestó sigue
    // contando. Si fueran dos NOT separados se negaría (a) Y (b), y eso
    // borraría de los reportes a TODO contacto sin inbound, comentario o no.
    expect(Object.keys(PROVISIONAL_COMMENT_LEAD).sort()).toEqual([
      "leadSourceDetail",
      "messages",
    ]);
  });

  it("identifica al provisional por la marca de origen, no por el canal", () => {
    // El canal (INSTAGRAM/MESSENGER) también lo usan los leads legítimos del
    // Inbox: filtrar por canal se llevaría a los buenos por delante.
    expect(PROVISIONAL_COMMENT_LEAD.leadSourceDetail).toEqual({ startsWith: "comentario:" });
    expect(PROVISIONAL_COMMENT_LEAD.messages).toEqual({ none: { direction: "INBOUND" } });
  });
});

import { describe, it, expect } from "vitest";
import { incomingLeadSchema } from "./rebuild-f1";

// El intake de conectores manda TODOS los campos crudos del formulario en `custom`
// para que no se pierda info (presupuesto, urgencia, etc. de preguntas custom).
describe("incomingLeadSchema captura campos custom", () => {
  it("preserva el objeto custom con todos los campos del formulario", () => {
    const r = incomingLeadSchema.safeParse({
      source: "FACEBOOK_ADS",
      firstName: "Ana",
      lastName: "L",
      email: "a@x.com",
      custom: { presupuesto: "2M", urgencia: "alta", interes_principal: "depto" },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.custom).toEqual({
        presupuesto: "2M",
        urgencia: "alta",
        interes_principal: "depto",
      });
    }
  });

  it("custom es opcional (no rompe leads sin campos extra)", () => {
    const r = incomingLeadSchema.safeParse({
      source: "WEBSITE",
      firstName: "B",
      email: "b@x.com",
    });
    expect(r.success).toBe(true);
  });
});

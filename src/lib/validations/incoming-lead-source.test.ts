import { describe, it, expect } from "vitest";
import { incomingLeadSchema } from "./rebuild-f1";

// Cada adapter de conector produce un `source`; todos deben ser aceptados por incomingLeadSchema,
// o captureLead descarta el lead silenciosamente.
describe("incomingLeadSchema acepta los source de todos los conectores", () => {
  for (const source of ["FACEBOOK_ADS", "INSTAGRAM", "MESSENGER", "TIKTOK_ADS", "GOOGLE_ADS", "LINKEDIN", "WEBSITE"]) {
    it(`acepta source=${source}`, () => {
      const r = incomingLeadSchema.safeParse({ firstName: "Ana", lastName: "L", phone: "+529981234567", source });
      expect(r.success).toBe(true);
    });
  }
});

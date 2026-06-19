import { describe, it, expect } from "vitest";
import { parseGoogleLeadForm } from "./parse";

describe("parseGoogleLeadForm", () => {
  it("extrae campos por column_id", () => {
    const payload = {
      lead_id: "abc",
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Ana López" },
        { column_id: "EMAIL", string_value: "ana@x.com" },
        { column_id: "PHONE_NUMBER", string_value: "+52 998 123 4567" },
      ],
    };
    const { externalLeadId, external } = parseGoogleLeadForm(payload);
    expect(externalLeadId).toBe("abc");
    expect(external.FULL_NAME).toBe("Ana López");
    expect(external.EMAIL).toBe("ana@x.com");
  });
});

// src/lib/mcp/dispatch.test.ts
import { describe, it, expect } from "vitest";
import { resolveRoute } from "./dispatch";

describe("resolveRoute", () => {
  it("resuelve introspección", () => {
    expect(resolveRoute("GET", ["health"])?.key).toBe("GET /health");
    expect(resolveRoute("GET", ["schema"])?.key).toBe("GET /schema");
  });
  it("resuelve colecciones y :id", () => {
    expect(resolveRoute("POST", ["automation", "rules"])?.key).toBe("POST /automation/rules");
    const r = resolveRoute("PATCH", ["automation", "rules", "abc"]);
    expect(r?.key).toBe("PATCH /automation/rules/:id");
    expect(r?.params.id).toBe("abc");
  });
  it("retorna null si no existe la ruta", () => {
    expect(resolveRoute("DELETE", ["automation", "rules", "abc"])).toBeNull();
    expect(resolveRoute("GET", ["nope"])).toBeNull();
  });
});

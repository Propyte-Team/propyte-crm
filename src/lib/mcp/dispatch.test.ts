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

  // F2 — Conectores
  it("resuelve POST /connectors", () => {
    expect(resolveRoute("POST", ["connectors"])?.key).toBe("POST /connectors");
  });
  it("resuelve PATCH /connectors/:id con params", () => {
    const r = resolveRoute("PATCH", ["connectors", "x"]);
    expect(r?.key).toBe("PATCH /connectors/:id");
    expect(r?.params.id).toBe("x");
  });

  // F3 — Configuración
  it("resuelve rutas de config/teams", () => {
    expect(resolveRoute("GET", ["config", "teams"])?.key).toBe("GET /config/teams");
    expect(resolveRoute("POST", ["config", "teams"])?.key).toBe("POST /config/teams");
    const r = resolveRoute("PATCH", ["config", "teams", "t1"]);
    expect(r?.key).toBe("PATCH /config/teams/:id");
    expect(r?.params.id).toBe("t1");
  });
  it("resuelve rutas de config/fields con GET", () => {
    expect(resolveRoute("GET", ["config", "fields"])?.key).toBe("GET /config/fields");
  });
  it("resuelve rutas de config/agents", () => {
    expect(resolveRoute("GET", ["config", "agents"])?.key).toBe("GET /config/agents");
    const r = resolveRoute("GET", ["config", "agents", "a1"]);
    expect(r?.key).toBe("GET /config/agents/:id");
    expect(r?.params.id).toBe("a1");
  });
  it("resuelve PUT /config/territories", () => {
    expect(resolveRoute("PUT", ["config", "territories"])?.key).toBe("PUT /config/territories");
  });

  // F4 — Datos
  it("resuelve GET /data/contacts y GET /data/contacts/:id", () => {
    expect(resolveRoute("GET", ["data", "contacts"])?.key).toBe("GET /data/contacts");
    const r = resolveRoute("GET", ["data", "contacts", "c1"]);
    expect(r?.key).toBe("GET /data/contacts/:id");
    expect(r?.params.id).toBe("c1");
  });
  it("resuelve POST /data/capture-lead", () => {
    expect(resolveRoute("POST", ["data", "capture-lead"])?.key).toBe("POST /data/capture-lead");
  });
  it("resuelve GET /data/quotes", () => {
    expect(resolveRoute("GET", ["data", "quotes"])?.key).toBe("GET /data/quotes");
  });
});

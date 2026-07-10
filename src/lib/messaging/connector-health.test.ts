import { describe, it, expect } from "vitest";
import { checkSocialConnector } from "./connector-health";

const base = { provider: "INSTAGRAM", config: { pageId: "P", igBusinessId: "IG" } } as never;

describe("checkSocialConnector", () => {
  it("ok cuando pageId+igBusinessId+pageAccessToken están presentes (IG)", () => {
    const r = checkSocialConnector(base, () => ({ pageAccessToken: "T" }));
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });
  it("reporta faltantes sin exponer valores", () => {
    const r = checkSocialConnector({ provider: "INSTAGRAM", config: { pageId: "P" } } as never, () => ({}));
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("config.igBusinessId");
    expect(r.missing).toContain("credentials.pageAccessToken");
  });
  it("Messenger no exige igBusinessId", () => {
    const r = checkSocialConnector({ provider: "MESSENGER", config: { pageId: "P" } } as never, () => ({ pageAccessToken: "T" }));
    expect(r.ok).toBe(true);
  });
});

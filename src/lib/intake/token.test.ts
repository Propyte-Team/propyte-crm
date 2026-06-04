import { describe, it, expect } from "vitest";
import { generateToken, isLinkUsable, defaultExpiry } from "./token";

describe("generateToken", () => {
  it("genera tokens url-safe únicos de longitud estable", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(16);
  });
});

describe("isLinkUsable", () => {
  const now = new Date("2026-06-03T12:00:00Z");
  it("usable cuando no está revocado ni expirado", () => {
    expect(isLinkUsable({ revokedAt: null, expiresAt: new Date("2026-06-10T00:00:00Z") }, now)).toBe(true);
  });
  it("no usable si revocado", () => {
    expect(isLinkUsable({ revokedAt: now, expiresAt: null }, now)).toBe(false);
  });
  it("no usable si expirado", () => {
    expect(isLinkUsable({ revokedAt: null, expiresAt: new Date("2026-06-01T00:00:00Z") }, now)).toBe(false);
  });
  it("usable si expiresAt es null (sin caducidad)", () => {
    expect(isLinkUsable({ revokedAt: null, expiresAt: null }, now)).toBe(true);
  });
});

describe("defaultExpiry", () => {
  it("son 15 días después de now", () => {
    const now = new Date("2026-06-03T00:00:00Z");
    expect(defaultExpiry(now).toISOString()).toBe("2026-06-18T00:00:00.000Z");
  });
});

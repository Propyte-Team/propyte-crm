import { describe, it, expect } from "vitest";
import { hashPII, buildHashedUserData } from "./hash";

describe("hashPII (SHA-256 normalizado, PA7)", () => {
  it("normaliza email: lowercase + trim", () => {
    expect(hashPII("email", "  Luis@Propyte.COM ")).toBe(hashPII("email", "luis@propyte.com"));
  });
  it("normaliza phone: E.164 sin '+'", () => {
    expect(hashPII("phone", "+52 984 123 4567")).toBe(hashPII("phone", "529841234567"));
  });
  it("normaliza nombres: lowercase sin acentos", () => {
    expect(hashPII("firstName", "José")).toBe(hashPII("firstName", "jose"));
  });
  it("produce hex de 64 chars y nunca el valor en claro", () => {
    const h = hashPII("email", "a@b.com")!;
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).not.toContain("a@b");
  });
  it("null-safe", () => {
    expect(hashPII("email", null)).toBeNull();
    expect(hashPII("email", "")).toBeNull();
  });
});

describe("buildHashedUserData", () => {
  it("arma em/ph/fn/ln estilo Meta y omite vacíos", () => {
    const d = buildHashedUserData({
      email: "a@b.com",
      phone: "+529841234567",
      firstName: "Ana",
      lastName: null,
    });
    expect(Object.keys(d).sort()).toEqual(["em", "fn", "ph"]);
    expect(d.em).toMatch(/^[a-f0-9]{64}$/);
  });
});

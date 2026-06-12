import { describe, it, expect, beforeAll } from "vitest";
import { encryptPII, decryptPII } from "./crypto";

beforeAll(() => {
  // 32 bytes en base64 solo para el test
  process.env.KYC_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("crypto PII (AES-256-GCM)", () => {
  it("roundtrip", () => {
    const enc = encryptPII("CURP123456HQRXXX01");
    expect(enc).not.toBeNull();
    expect(enc).not.toContain("CURP");
    expect(decryptPII(enc)).toBe("CURP123456HQRXXX01");
  });
  it("dos cifrados del mismo texto difieren (IV aleatorio)", () => {
    expect(encryptPII("X")).not.toBe(encryptPII("X"));
  });
  it("null-safe", () => {
    expect(encryptPII(null)).toBeNull();
    expect(decryptPII(null)).toBeNull();
    expect(encryptPII("")).toBeNull();
  });
  it("rechaza ciphertext manipulado", () => {
    const enc = encryptPII("dato")!;
    const tampered = enc.slice(0, -4) + "AAAA";
    expect(() => decryptPII(tampered)).toThrow();
  });
  it("falla claro si no hay llave", () => {
    const saved = process.env.KYC_ENCRYPTION_KEY;
    delete process.env.KYC_ENCRYPTION_KEY;
    expect(() => encryptPII("x")).toThrow(/KYC_ENCRYPTION_KEY/);
    process.env.KYC_ENCRYPTION_KEY = saved;
  });
});

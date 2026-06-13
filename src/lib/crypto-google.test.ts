// src/lib/crypto-google.test.ts
import { describe, it, expect, beforeAll } from "vitest"
import { encryptGoogleToken, decryptGoogleToken } from "./crypto-google"

beforeAll(() => {
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64")
})

describe("crypto-google (AES-256-GCM)", () => {
  it("roundtrip", () => {
    const enc = encryptGoogleToken("ya29.a0AfH-token")
    expect(enc).not.toBeNull()
    expect(enc).not.toContain("ya29")
    expect(decryptGoogleToken(enc)).toBe("ya29.a0AfH-token")
  })
  it("dos cifrados del mismo texto difieren (IV aleatorio)", () => {
    expect(encryptGoogleToken("X")).not.toBe(encryptGoogleToken("X"))
  })
  it("null-safe", () => {
    expect(encryptGoogleToken(null)).toBeNull()
    expect(decryptGoogleToken(null)).toBeNull()
    expect(encryptGoogleToken("")).toBeNull()
  })
  it("rechaza ciphertext manipulado", () => {
    const enc = encryptGoogleToken("dato")!
    const tampered = enc.slice(0, -4) + "AAAA"
    expect(() => decryptGoogleToken(tampered)).toThrow()
  })
  it("falla claro si no hay llave", () => {
    const saved = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
    expect(() => encryptGoogleToken("x")).toThrow(/GOOGLE_TOKEN_ENCRYPTION_KEY/)
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = saved
  })
})

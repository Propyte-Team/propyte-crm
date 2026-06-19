// src/lib/mcp/auth.test.ts
import { describe, it, expect } from "vitest";
import { checkBearer } from "./auth";

describe("checkBearer", () => {
  const token = "tok_abc123";
  it("acepta el token correcto", () => {
    expect(checkBearer(`Bearer ${token}`, token)).toBe(true);
  });
  it("rechaza token incorrecto", () => {
    expect(checkBearer("Bearer wrong", token)).toBe(false);
  });
  it("rechaza header faltante o mal formado", () => {
    expect(checkBearer(null, token)).toBe(false);
    expect(checkBearer("Token x", token)).toBe(false);
  });
  it("tolera espacios/newline trailing en el token recibido", () => {
    expect(checkBearer(`Bearer ${token}\n`, token)).toBe(true);
  });
});

// src/lib/mcp/auth.test.ts
import { describe, it, expect } from "vitest";
import { checkBearer, nivelDeAcceso } from "./auth";

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

describe("nivelDeAcceso", () => {
  const tokens = { escritura: "tok_write_0001", soloLectura: "tok_read_0002" };
  const bearer = (t: string) => `Bearer ${t}`;

  it("distingue las dos credenciales", () => {
    expect(nivelDeAcceso(bearer(tokens.escritura), tokens)).toBe("escritura");
    expect(nivelDeAcceso(bearer(tokens.soloLectura), tokens)).toBe("solo_lectura");
  });

  it("lo desconocido no es ninguno de los dos", () => {
    expect(nivelDeAcceso(bearer("tok_ajeno"), tokens)).toBe("ninguno");
    expect(nivelDeAcceso(null, tokens)).toBe("ninguno");
  });

  // Sin la variable configurada, la lectura separada simplemente no existe: es el estado
  // de un despliegue que todavía no la puso, y no debe abrir nada.
  it("sin token de lectura, solo hay escritura", () => {
    const solo = { escritura: tokens.escritura, soloLectura: "" };
    expect(nivelDeAcceso(bearer(tokens.escritura), solo)).toBe("escritura");
    expect(nivelDeAcceso(bearer(tokens.soloLectura), solo)).toBe("ninguno");
  });

  // Ni un header vacío ni un token vacío abren nada: `checkBearer` ya lo cubre, pero el
  // caso vive aquí porque es el que un `.env` a medio llenar produce de verdad.
  it("con los dos tokens vacíos nadie entra", () => {
    expect(nivelDeAcceso(bearer(""), { escritura: "", soloLectura: "" })).toBe("ninguno");
  });

  /**
   * 🚨 Los dos con el mismo valor: se ignora el de lectura. Conceder escritura bajo un
   * nombre que dice «readonly» es peor que no tener la variable — leer el `.env` sugeriría
   * una separación de privilegios que no existe.
   */
  it("si coinciden, el de lectura se ignora en vez de degradar al de escritura", () => {
    const iguales = { escritura: tokens.escritura, soloLectura: tokens.escritura };
    expect(nivelDeAcceso(bearer(tokens.escritura), iguales)).toBe("escritura");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// #839: «¿Olvidaste tu contraseña?» y «código de acceso» cuando el correo NO sale.
// Antes: 500 «Error al procesar la solicitud» y el código se quedaba guardado.
// Ahora: 503 con `codigo: "correo_no_enviado"` y el código recién guardado se anula.
// Las dos rutas comparten la regla, así que se prueban las dos con el mismo cuerpo.

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const userUpdateMany = vi.fn();
vi.mock("@/lib/db", () => {
  const user = {
    findUnique: (a: unknown) => userFindUnique(a),
    update: (a: unknown) => userUpdate(a),
    updateMany: (a: unknown) => userUpdateMany(a),
  };
  return { prisma: { user }, default: { user } };
});

vi.mock("bcryptjs", () => ({ hash: vi.fn(async () => "HASH_DEL_CODIGO") }));

vi.mock("@/lib/security/rate-limit", () => ({
  registrarIntento: () => ({ permitido: true, esperarMs: 0 }),
  olvidarIntentos: vi.fn(),
  ipDe: () => "1.2.3.4",
}));

const enviarRestablecer = vi.fn();
const enviarAcceso = vi.fn();
vi.mock("@/lib/email/mailer", () => {
  class CorreoNoEnviadoError extends Error {
    constructor(m: string, readonly causaOriginal?: unknown) {
      super(m);
    }
  }
  return {
    CorreoNoEnviadoError,
    sendPasswordResetCode: (e: string, c: string) => enviarRestablecer(e, c),
    sendLoginCode: (e: string, c: string) => enviarAcceso(e, c),
  };
});

import { CorreoNoEnviadoError } from "@/lib/email/mailer";
import { POST as olvide } from "./route";
import { POST as codigoAcceso } from "../request-code/route";

function req(ruta: string, body: unknown) {
  return new Request(`http://localhost${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

const RUTAS = [
  { nombre: "forgot-password", post: olvide, ruta: "/api/auth/forgot-password", envio: enviarRestablecer },
  { nombre: "request-code", post: codigoAcceso, ruta: "/api/auth/request-code", envio: enviarAcceso },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  userFindUnique.mockResolvedValue({ id: "u-1", isActive: true, email: "fernanda@propyte.com" });
  userUpdate.mockResolvedValue({});
  userUpdateMany.mockResolvedValue({ count: 1 });
  enviarRestablecer.mockResolvedValue(undefined);
  enviarAcceso.mockResolvedValue(undefined);
});

describe.each(RUTAS)("$nombre cuando el correo no sale (#839)", ({ post, ruta, envio }) => {
  it("responde 503 con un código que la pantalla reconoce, no el 500 genérico", async () => {
    envio.mockRejectedValue(new CorreoNoEnviadoError("No se pudo enviar", undefined));
    const res = await post(req(ruta, { email: "fernanda@propyte.com" }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.codigo).toBe("correo_no_enviado");
    expect(body.error).toContain("Avisa al administrador");
  });

  it("anula el código que acaba de guardar, solo si sigue siendo el suyo", async () => {
    envio.mockRejectedValue(new CorreoNoEnviadoError("No se pudo enviar", undefined));
    await post(req(ruta, { email: "fernanda@propyte.com" }));

    expect(userUpdate).toHaveBeenCalledTimes(1); // el que guarda el código
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: "u-1", otpHash: "HASH_DEL_CODIGO" },
      data: { otpHash: null, otpExpiresAt: null },
    });
  });

  it("un error que NO es del correo sigue siendo el 500 de siempre y no anula nada", async () => {
    envio.mockRejectedValue(new Error("otra cosa"));
    const res = await post(req(ruta, { email: "fernanda@propyte.com" }));
    expect(res.status).toBe(500);
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("si el correo sale, nada cambia: 200 y el código se queda", async () => {
    const res = await post(req(ruta, { email: "fernanda@propyte.com" }));
    expect(res.status).toBe(200);
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("un correo que no existe sigue recibiendo la respuesta genérica, sin intentar enviar", async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await post(req(ruta, { email: "nadie@propyte.com" }));
    expect(res.status).toBe(200);
    expect(envio).not.toHaveBeenCalled();
  });
});

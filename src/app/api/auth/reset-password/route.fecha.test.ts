import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #699, defecto 1 — la mitad de COMPORTAMIENTO.
//
// `password-changed-at.test.ts` vigila que ninguna vía FUTURA se olvide de la fecha,
// leyendo el código fuente. Esto es lo otro: que la vía que de verdad se usa —el usuario
// cambiando su contraseña con el código que le llegó por correo— la escriba, y que la
// escriba en la MISMA operación que el hash.
//
// Que vayan juntas importa: si fueran dos escrituras, una podría quedarse a medias y el
// campo diría que la contraseña cambió cuando no, o al revés.

// Los dobles reciben UN argumento, no un spread: `findUnique` y `update` de Prisma toman
// exactamente uno, y escribirlo así evita un error de tipos (TS2556) que no existía en
// ningún otro archivo del repo. Una clase de error nueva es señal de regresión aunque
// venga de una prueba, así que se arregla en vez de declararla como ruido.
const userFindUnique = vi.fn();
const userUpdate = vi.fn();
// El objeto se arma DENTRO de la fábrica: `vi.mock` se iza por encima de las constantes
// de este archivo, así que una referencia directa desde fuera reventaría al importar.
// Las flechas sí valen, porque resuelven la constante cuando se llaman, no antes.
vi.mock("@/lib/db", () => {
  const user = { findUnique: (a: unknown) => userFindUnique(a), update: (a: unknown) => userUpdate(a) };
  return { prisma: { user }, default: { user } };
});

vi.mock("bcryptjs", () => ({
  hash: vi.fn(async () => "HASH_NUEVO"),
  compare: vi.fn(async (a: string) => a === "123456"),
}));

const registrarIntento = vi.fn(() => ({ permitido: true, esperarMs: 0 }));
vi.mock("@/lib/security/rate-limit", () => ({
  registrarIntento: (_politica: string, _id: string) => registrarIntento(),
  olvidarIntentos: vi.fn(),
}));

import { POST } from "./route";

const ANTES = new Date("2026-09-15T12:00:00.000Z");
const DENTRO_DE_UNA_HORA = new Date(Date.now() + 3_600_000);

function req(body: unknown) {
  return new Request("http://localhost/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

const CUERPO = { email: "sonia@nativatulum.mx", code: "123456", newPassword: "contrasena-nueva" };

beforeEach(() => {
  vi.clearAllMocks();
  registrarIntento.mockReturnValue({ permitido: true, esperarMs: 0 });
  userUpdate.mockResolvedValue({});
  userFindUnique.mockResolvedValue({
    id: "u-1",
    isActive: true,
    otpHash: "HASH_DEL_CODIGO",
    otpExpiresAt: DENTRO_DE_UNA_HORA,
  });
});

describe("cambiar la contraseña deja constancia de CUÁNDO (#699)", () => {
  it("escribe passwordChangedAt junto al hash, en la misma operación", async () => {
    const res = await POST(req(CUERPO));

    expect(res.status).toBe(200);
    expect(userUpdate).toHaveBeenCalledTimes(1);

    const { data } = userUpdate.mock.calls[0][0];
    expect(data.passwordHash).toBe("HASH_NUEVO");
    expect(data.passwordChangedAt).toBeInstanceOf(Date);
  });

  it("la fecha es la de AHORA, no una heredada ni una fija", async () => {
    // Un `passwordChangedAt` copiado de otro campo —o peor, una constante— pasaría la
    // prueba de arriba y seguiría sin servir para auditar nada.
    const antes = Date.now();
    await POST(req(CUERPO));
    const despues = Date.now();

    const fecha: Date = userUpdate.mock.calls[0][0].data.passwordChangedAt;
    expect(fecha.getTime()).toBeGreaterThanOrEqual(antes);
    expect(fecha.getTime()).toBeLessThanOrEqual(despues);
    expect(fecha.getTime()).toBeGreaterThan(ANTES.getTime());
  });

  it("sigue limpiando el código de un solo uso al consumirlo", async () => {
    // Barandilla: esto ya funcionaba y es la mitad del defecto 2 que SÍ está resuelta.
    // Si al añadir la fecha se rompiera, el código usado se quedaría guardado.
    await POST(req(CUERPO));

    const { data } = userUpdate.mock.calls[0][0];
    expect(data.otpHash).toBeNull();
    expect(data.otpExpiresAt).toBeNull();
  });
});

describe("barandilla: no se escribe nada cuando no toca (#699)", () => {
  it("con el código vencido no se cambia la contraseña ni la fecha", async () => {
    userFindUnique.mockResolvedValue({
      id: "u-1",
      isActive: true,
      otpHash: "HASH_DEL_CODIGO",
      otpExpiresAt: new Date(Date.now() - 1000),
    });

    const res = await POST(req(CUERPO));

    expect(res.status).toBe(400);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("con el código equivocado tampoco", async () => {
    const res = await POST(req({ ...CUERPO, code: "999999" }));

    expect(res.status).toBe(400);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("si el tope de intentos corta, no se llega a escribir", async () => {
    registrarIntento.mockReturnValue({ permitido: false, esperarMs: 600_000 });

    const res = await POST(req(CUERPO));

    expect(res.status).toBe(429);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

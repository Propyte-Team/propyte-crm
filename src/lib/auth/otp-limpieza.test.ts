import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const updateMany = vi.fn();

// La fábrica construye el objeto DENTRO: `vi.mock` se iza por encima de cualquier `const`
// de fuera, y referenciarlo desde aquí rompe la carga del módulo.
vi.mock("@/lib/db", () => {
  const user = { updateMany: (a: unknown) => updateMany(a) };
  return { prisma: { user }, default: { user } };
});

import { limpiarOtpVencidos } from "./otp-limpieza";

const AHORA = new Date("2026-09-15T12:00:00.000Z");

/** El único argumento con el que se llamó a `updateMany`. */
function laLlamada() {
  expect(updateMany).toHaveBeenCalledTimes(1);
  return updateMany.mock.calls[0][0] as {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  };
}

beforeEach(() => {
  updateMany.mockReset();
  updateMany.mockResolvedValue({ count: 0 });
});

describe("limpiarOtpVencidos — qué borra", () => {
  it("sólo mira filas que TIENEN un hash de código dentro", async () => {
    await limpiarOtpVencidos(AHORA);
    expect(laLlamada().where.otpHash).toEqual({ not: null });
  });

  /**
   * 🚨 El borde, y la razón por la que esta prueba existe.
   *
   * Las dos vías de consumo rechazan con `new Date() > otpExpiresAt`, o sea que en el
   * instante EXACTO del vencimiento el código todavía se acepta. Si este barrido usara
   * `lte`, durante ese milisegundo borraría un código que el inicio de sesión aún daría
   * por bueno, y el usuario vería «código inválido» sobre uno correcto.
   *
   * Un `lte` aquí parece una limpieza inocente. No lo es.
   */
  it("usa `lt` y NO `lte`: en el instante del vencimiento el código todavía vale", async () => {
    await limpiarOtpVencidos(AHORA);

    const or = laLlamada().where.OR as Array<Record<string, unknown>>;
    expect(or).toContainEqual({ otpExpiresAt: { lt: AHORA } });
    expect(JSON.stringify(or)).not.toContain("lte");
  });

  it("también retira un hash con fecha nula, que ninguna vía puede aceptar nunca", async () => {
    await limpiarOtpVencidos(AHORA);

    const or = laLlamada().where.OR as Array<Record<string, unknown>>;
    expect(or).toContainEqual({ otpExpiresAt: null });
  });

  it("usa la hora que se le da, no una constante ni una propia", async () => {
    const otra = new Date("2025-01-01T00:00:00.000Z");
    await limpiarOtpVencidos(otra);

    const or = laLlamada().where.OR as Array<Record<string, unknown>>;
    expect(or).toContainEqual({ otpExpiresAt: { lt: otra } });
  });

  it("sin hora explícita usa la de ahora, dentro de un margen razonable", async () => {
    const antes = Date.now();
    await limpiarOtpVencidos();
    const despues = Date.now();

    const or = laLlamada().where.OR as Array<Record<string, unknown>>;
    const usada = (or[0].otpExpiresAt as { lt: Date }).lt;
    expect(usada.getTime()).toBeGreaterThanOrEqual(antes);
    expect(usada.getTime()).toBeLessThanOrEqual(despues);
  });
});

describe("limpiarOtpVencidos — qué escribe", () => {
  /**
   * El conjunto se comprueba EXACTO, igual que en `admin.resetPassword.test.ts` y por la
   * misma razón: es lo que impide que este barrido —que corre solo, cada minuto, sobre la
   * tabla de usuarios— cambie de paso el rol, el estado activo o la contraseña de alguien.
   * Si algún día tiene que escribir un campo más, que sea una decisión visible y no un
   * `toContain` que la deja pasar.
   */
  it("pone a null los dos campos del código y NADA más", async () => {
    await limpiarOtpVencidos(AHORA);

    const { data } = laLlamada();
    expect(Object.keys(data).sort()).toEqual(["otpExpiresAt", "otpHash"]);
    expect(data.otpHash).toBeNull();
    expect(data.otpExpiresAt).toBeNull();
  });

  it("no toca passwordHash ni el estado de la cuenta", async () => {
    await limpiarOtpVencidos(AHORA);

    const { data } = laLlamada();
    expect(data.passwordHash).toBeUndefined();
    expect(data.passwordChangedAt).toBeUndefined();
    expect(data.isActive).toBeUndefined();
    expect(data.role).toBeUndefined();
  });

  it("devuelve lo que la base dice que escribió, no lo que creía que iba a escribir", async () => {
    updateMany.mockResolvedValue({ count: 3 });
    await expect(limpiarOtpVencidos(AHORA)).resolves.toBe(3);
  });

  /**
   * Un solo `updateMany`, sin `findMany` previo ni tope. No es descuido frente a las otras
   * etapas del tick, que sí llevan límite: un `findMany` con `take` y luego un update por
   * ids abre una ventana en la que un código pedido a mitad del barrido se borra recién
   * nacido. Postgres evalúa el predicado en el momento de escribir, así que la forma de
   * una sola sentencia no tiene esa ventana.
   */
  it("es una sola escritura atómica: sin tope y sin lectura previa", async () => {
    await limpiarOtpVencidos(AHORA);

    const llamada = laLlamada();
    expect(llamada).not.toHaveProperty("take");
    expect(llamada).not.toHaveProperty("skip");
    expect(llamada).not.toHaveProperty("limit");
  });
});

/**
 * La regla de vigencia está escrita en TRES sitios: las dos vías que consumen un código y
 * este barrido. Es exactamente la familia de defectos que ya costó ocho tarjetas (#715
 * A-03, #730, #682, #684, #685, #763, #764, #775): una regla copiada que divergió.
 *
 * Aquí no se puede unificar de verdad —las dos vías comparan en JavaScript sobre una fila
 * ya leída y el barrido compara en SQL sobre el conjunto—, así que en vez de fingir que
 * son una sola, esta prueba ATA las tres: si alguien cambia el `>` de una vía por un `>=`,
 * el `lt` de arriba deja de ser el borde correcto y hay que moverlo a `lte`. Esta prueba
 * falla y lo dice.
 */
describe("la vigencia sigue definida igual en las vías de consumo", () => {
  const VIAS = [
    "src/lib/auth/options.ts",
    "src/app/api/auth/reset-password/route.ts",
  ] as const;

  // `new Date() > user.otpExpiresAt` — con o sin espacios, con el prefijo que sea.
  const COMPARACION = /new Date\(\)\s*(>=?)\s*[\w.]*otpExpiresAt/;

  for (const via of VIAS) {
    it(`${via} rechaza con \`>\` estricto, así que el barrido usa \`lt\``, () => {
      const fuente = readFileSync(resolve(process.cwd(), via), "utf8");
      const m = fuente.match(COMPARACION);

      // Si esto falla, la comparación se movió o se reescribió: hay que volver a mirar el
      // borde a mano antes de tocar nada.
      expect(m, `no se encontró la comprobación de vigencia en ${via}`).not.toBeNull();
      expect(m?.[1]).toBe(">");
    });
  }

  // La propia prueba de arriba tiene que saber distinguir `>` de `>=`, o pasaría en verde
  // sobre cualquier cosa.
  it("el rastreo distingue `>` de `>=`", () => {
    expect("if (new Date() > user.otpExpiresAt) {".match(COMPARACION)?.[1]).toBe(">");
    expect("if (new Date() >= user.otpExpiresAt) {".match(COMPARACION)?.[1]).toBe(">=");
    expect("if (new Date() < user.otpExpiresAt) {".match(COMPARACION)).toBeNull();
  });
});

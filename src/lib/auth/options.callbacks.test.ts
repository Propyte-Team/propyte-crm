import { describe, it, expect, vi, beforeEach } from "vitest";

// #79x — antes de este cambio, `callbacks.jwt` solo copiaba datos EN EL LOGIN y nunca
// volvía a preguntarle nada a la base: un usuario eliminado o al que le acababan de
// cambiar la contraseña seguía con el CRM abierto hasta que su JWT expirara solo (hasta
// 5h, session.maxAge). Estas pruebas fijan el comportamiento nuevo — y, a propósito,
// también fijan lo que NO cambió: la tarjeta #777 (desactivar simple no revalida aquí)
// sigue abierta tal cual, por decisión explícita.

const userFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
    },
  },
}));

// authOptions también arma un PrismaAdapter y un CredentialsProvider al importarse;
// ninguno de los dos llama a la base en el import, así que no hace falta mockearlos —
// solo @/lib/db, que sí instanciaría un PrismaClient real (bloqueado en este sandbox).

import { authOptions } from "./options";

const jwt = authOptions.callbacks!.jwt!;
const session = authOptions.callbacks!.session!;

const IAT_BASE = Math.floor(new Date("2026-09-20T12:00:00Z").getTime() / 1000);

function tokenBase() {
  return {
    id: "user-1",
    role: "ASESOR_SR",
    plaza: "PDC",
    careerLevel: "SR",
    iat: IAT_BASE,
  };
}

beforeEach(() => {
  userFindUnique.mockReset();
});

describe("callbacks.jwt — login fresco", () => {
  it("copia los datos de `user` sin tocar la base y marca revoked:false", async () => {
    const user = { id: "user-1", role: "ASESOR_SR", plaza: "PDC", careerLevel: "SR" } as any;
    const token = await jwt({ token: { iat: IAT_BASE } as any, user, account: null, profile: undefined, trigger: "signIn" } as any);

    expect(token).toMatchObject({ id: "user-1", role: "ASESOR_SR", revoked: false });
    expect(userFindUnique).not.toHaveBeenCalled();
  });
});

describe("callbacks.jwt — relectura de una sesión existente", () => {
  it("marca revoked:true si el usuario fue eliminado (deletedAt no nulo)", async () => {
    userFindUnique.mockResolvedValue({ deletedAt: new Date("2026-09-21T00:00:00Z"), passwordChangedAt: null });

    const token = await jwt({ token: tokenBase() as any, user: undefined, account: null, profile: undefined, trigger: "update" } as any);

    expect(token.revoked).toBe(true);
  });

  it("marca revoked:true si el usuario ya no existe (lo elimina otra sesión y el findUnique no encuentra nada)", async () => {
    userFindUnique.mockResolvedValue(null);

    const token = await jwt({ token: tokenBase() as any, user: undefined, account: null, profile: undefined, trigger: "update" } as any);

    expect(token.revoked).toBe(true);
  });

  it("marca revoked:true si la contraseña cambió DESPUÉS de que se firmó este token", async () => {
    userFindUnique.mockResolvedValue({
      deletedAt: null,
      passwordChangedAt: new Date((IAT_BASE + 3600) * 1000), // una hora después del iat
    });

    const token = await jwt({ token: tokenBase() as any, user: undefined, account: null, profile: undefined, trigger: "update" } as any);

    expect(token.revoked).toBe(true);
  });

  it("NO marca revoked si la contraseña cambió ANTES de que se firmara este token", async () => {
    userFindUnique.mockResolvedValue({
      deletedAt: null,
      passwordChangedAt: new Date((IAT_BASE - 3600) * 1000), // una hora antes del iat
    });

    const token = await jwt({ token: tokenBase() as any, user: undefined, account: null, profile: undefined, trigger: "update" } as any);

    expect(token.revoked).toBeFalsy();
  });

  it("una simple desactivación (isActive:false) NO revoca aquí — alcance explícito de la #777", async () => {
    // El select de la revalidación ni siquiera pide `isActive`: este caso se deja tal
    // cual estaba, a propósito. Se simula devolviendo solo lo que el select real trae.
    userFindUnique.mockResolvedValue({ deletedAt: null, passwordChangedAt: null });

    const token = await jwt({ token: tokenBase() as any, user: undefined, account: null, profile: undefined, trigger: "update" } as any);

    expect(token.revoked).toBeFalsy();
  });

  it("si la base falla, no tumba la sesión por un error transitorio (best-effort)", async () => {
    userFindUnique.mockRejectedValue(new Error("timeout de conexión"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const token = await jwt({ token: tokenBase() as any, user: undefined, account: null, profile: undefined, trigger: "update" } as any);

    expect(token.revoked).toBeFalsy();
    expect(errSpy).toHaveBeenCalled();
  });
});

describe("callbacks.session", () => {
  it("con revoked:true, devuelve null — el patrón de NextAuth v4 para forzar el cierre de sesión", async () => {
    const result = await session({
      session: { user: {}, expires: "" } as any,
      token: { ...tokenBase(), revoked: true } as any,
      newSession: undefined,
      trigger: "update",
    } as any);

    expect(result).toBeNull();
  });

  it("sin revoked, arma la sesión normalmente a partir del token", async () => {
    const result = await session({
      session: { user: {}, expires: "2026-09-25T00:00:00Z" } as any,
      token: { ...tokenBase(), revoked: false } as any,
      newSession: undefined,
      trigger: "update",
    } as any);

    expect(result).toMatchObject({
      user: { id: "user-1", role: "ASESOR_SR", plaza: "PDC", careerLevel: "SR" },
    });
  });
});

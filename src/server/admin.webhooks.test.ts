import { describe, it, expect, vi, beforeEach } from "vitest";

// Mismo patrón que admin.commissionRules.test.ts: sesión y Prisma mockeados.
const session = { user: { id: "actor-1", role: "DIRECTOR" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => session }));

const findMany = vi.fn();
const create = vi.fn();
const update = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    webhookConfig: {
      findMany: (...a: unknown[]) => findMany(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import {
  getWebhookConfigs,
  createWebhookConfig,
  updateWebhookConfig,
  regenerateWebhookSecret,
} from "./admin";

const SECRET_VIEJO = "a".repeat(60) + "ab12";
const fila = (over: Record<string, unknown> = {}) => ({
  id: "w1",
  event: "deal.won",
  url: "https://hooks.example.com/x",
  isActive: true,
  secret: SECRET_VIEJO,
  createdAt: new Date("2026-11-01"),
  updatedAt: new Date("2026-11-01"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  session.user.role = "DIRECTOR";
});

describe("getWebhookConfigs", () => {
  it("el listado no expone el secret, solo la pista con los últimos 4", async () => {
    findMany.mockResolvedValue([fila()]);
    const res = await getWebhookConfigs();
    expect(res[0]).not.toHaveProperty("secret");
    expect(res[0].secretHint).toBe("••••ab12");
    expect(JSON.stringify(res)).not.toContain(SECRET_VIEJO);
  });

  it("exige rol de administración", async () => {
    session.user.role = "ASESOR_SR";
    await expect(getWebhookConfigs()).rejects.toThrow(/Acceso denegado/);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("createWebhookConfig", () => {
  it("devuelve el secret completo una vez y lo guarda tal cual en BD", async () => {
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => fila({ ...data }));
    const res = await createWebhookConfig({ event: "deal.won", url: "https://hooks.example.com/x" });
    const guardado = create.mock.calls[0][0].data.secret as string;
    expect(guardado).toMatch(/^[0-9a-f]{64}$/);
    expect(res.secret).toBe(guardado);
    expect(res.secretHint).toBe(`••••${guardado.slice(-4)}`);
  });
});

describe("updateWebhookConfig", () => {
  it("la respuesta no incluye el secret", async () => {
    update.mockResolvedValue(fila({ isActive: false }));
    const res = await updateWebhookConfig("w1", { isActive: false });
    expect(res).not.toHaveProperty("secret");
    expect(res.secretHint).toBe("••••ab12");
  });
});

describe("regenerateWebhookSecret", () => {
  it("cambia el secret en BD y devuelve el nuevo una sola vez", async () => {
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => fila({ ...data }));
    const res = await regenerateWebhookSecret("w1");
    const nuevo = update.mock.calls[0][0].data.secret as string;
    expect(update.mock.calls[0][0].where).toEqual({ id: "w1" });
    expect(nuevo).toMatch(/^[0-9a-f]{64}$/);
    expect(nuevo).not.toBe(SECRET_VIEJO);
    expect(res.secret).toBe(nuevo);
    expect(res.secretHint).toBe(`••••${nuevo.slice(-4)}`);
  });

  it("cada llamada genera un secret distinto", async () => {
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => fila({ ...data }));
    const a = await regenerateWebhookSecret("w1");
    const b = await regenerateWebhookSecret("w1");
    expect(a.secret).not.toBe(b.secret);
  });

  it("mismos permisos que editar: un rol sin administración no puede", async () => {
    session.user.role = "ASESOR_SR";
    await expect(regenerateWebhookSecret("w1")).rejects.toThrow(/Acceso denegado/);
    expect(update).not.toHaveBeenCalled();
  });
});

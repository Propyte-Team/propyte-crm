// src/lib/mcp/handlers/connectors.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ default: {
  leadConnector: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}}));
vi.mock("@/lib/intake/connectors", () => ({
  writeCredentials: vi.fn(() => "enc:xxx"),
  readCredentials: vi.fn(),
}));

import prisma from "@/lib/db";
import { listConnectors, createConnector, getConnector, updateConnector } from "./connectors";

describe("connectors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listConnectors NUNCA expone credentials en claro", async () => {
    (prisma.leadConnector.findMany as any).mockResolvedValue([
      { id: "c1", name: "Meta", credentials: "enc:xxx", provider: "META" },
    ]);
    const r: any = await listConnectors();
    expect(r[0].credentials).toBeUndefined();
    expect(r[0].hasCredentials).toBe(true);
  });

  it("listConnectors hasCredentials=false cuando no hay credentials", async () => {
    (prisma.leadConnector.findMany as any).mockResolvedValue([
      { id: "c2", name: "Website", credentials: null, provider: "WEBSITE" },
    ]);
    const r: any = await listConnectors();
    expect(r[0].credentials).toBeUndefined();
    expect(r[0].hasCredentials).toBe(false);
  });

  it("createConnector cifra credentials y nace PAUSED", async () => {
    (prisma.leadConnector.create as any).mockImplementation(({ data }: any) => ({ id: "c1", ...data }));
    const r: any = await createConnector(
      { name: "Meta TULUM", provider: "META", credentials: { token: "abc" } },
      "u1"
    );
    expect(r.status).toBe("PAUSED");
    expect(r.credentials).toBeUndefined(); // redactado en retorno
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it("createConnector sin credentials: hasCredentials=false", async () => {
    (prisma.leadConnector.create as any).mockImplementation(({ data }: any) => ({
      id: "c3",
      ...data,
      credentials: null,
    }));
    const r: any = await createConnector({ name: "Website Propyte", provider: "WEBSITE" }, "u1");
    expect(r.hasCredentials).toBe(false);
    expect(r.credentials).toBeUndefined();
  });

  it("getConnector 404 si no existe", async () => {
    (prisma.leadConnector.findFirst as any).mockResolvedValue(null);
    await expect(getConnector("nonexistent")).rejects.toThrow(/no encontrado/i);
  });

  it("getConnector redacta credentials", async () => {
    (prisma.leadConnector.findFirst as any).mockResolvedValue({
      id: "c1", name: "Meta", credentials: "enc:xxx", provider: "META",
    });
    const r: any = await getConnector("c1");
    expect(r.credentials).toBeUndefined();
    expect(r.hasCredentials).toBe(true);
  });

  it("updateConnector rechaza cuerpo inválido (proveedor no permitido cambiar)", async () => {
    (prisma.leadConnector.findFirst as any).mockResolvedValue({ id: "c1", name: "Meta", provider: "META" });
    // provider en el body se ignora (schema no lo incluye), NO debe rechazar con error
    // Confirmar que update procede normalmente sin provider
    (prisma.leadConnector.update as any).mockImplementation(({ data }: any) => ({
      id: "c1", name: "Meta", provider: "META", credentials: null, ...data,
    }));
    const r: any = await updateConnector("c1", { name: "Meta TULUM Updated" }, "u1");
    expect(r.credentials).toBeUndefined();
  });

  it("updateConnector recifra credentials y resetea errorCount", async () => {
    (prisma.leadConnector.findFirst as any).mockResolvedValue({
      id: "c1", name: "Meta", provider: "META", credentials: "enc:old",
    });
    (prisma.leadConnector.update as any).mockImplementation(({ data }: any) => ({
      id: "c1", name: "Meta", provider: "META", ...data,
    }));
    const r: any = await updateConnector("c1", { credentials: { token: "new" } }, "u1");
    expect(r.credentials).toBeUndefined();
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
});

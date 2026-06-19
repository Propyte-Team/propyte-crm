// src/lib/mcp/handlers/data.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ default: {
  contact: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  deal:    { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  quote:   { findMany: vi.fn() },
}}));

import prisma from "@/lib/db";
import { searchContacts, getContactById, listDeals, getDealById, listQuotes } from "./data";

describe("searchContacts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clampea pageSize a 100", async () => {
    (prisma.contact.findMany as any).mockResolvedValue([]);
    (prisma.contact.count as any).mockResolvedValue(0);
    await searchContacts({ pageSize: 999 });
    const call = (prisma.contact.findMany as any).mock.calls[0][0];
    expect(call.take).toBe(100);
  });

  it("search arma OR sobre firstName/lastName/email/phone", async () => {
    (prisma.contact.findMany as any).mockResolvedValue([]);
    (prisma.contact.count as any).mockResolvedValue(0);
    await searchContacts({ search: "Luis" });
    const call = (prisma.contact.findMany as any).mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
    expect(call.where.OR.length).toBeGreaterThan(1);
  });

  it("sin search no incluye OR", async () => {
    (prisma.contact.findMany as any).mockResolvedValue([]);
    (prisma.contact.count as any).mockResolvedValue(0);
    await searchContacts({});
    const call = (prisma.contact.findMany as any).mock.calls[0][0];
    expect(call.where.OR).toBeUndefined();
  });

  it("devuelve data + total + page + pageSize", async () => {
    (prisma.contact.findMany as any).mockResolvedValue([{ id: "c1" }]);
    (prisma.contact.count as any).mockResolvedValue(1);
    const r: any = await searchContacts({ page: 1, pageSize: 10 });
    expect(r.data).toHaveLength(1);
    expect(r.total).toBe(1);
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(10);
  });
});

describe("getContactById", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404 si no existe", async () => {
    (prisma.contact.findUnique as any).mockResolvedValue(null);
    await expect(getContactById("missing")).rejects.toThrow(/no encontrado/i);
  });

  it("incluye deals y activities", async () => {
    (prisma.contact.findUnique as any).mockResolvedValue({
      id: "c1", firstName: "Luis", deals: [], activities: [],
    });
    const r: any = await getContactById("c1");
    expect(r.id).toBe("c1");
  });
});

describe("listDeals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("devuelve deals con total", async () => {
    (prisma.deal.findMany as any).mockResolvedValue([{ id: "d1" }]);
    (prisma.deal.count as any).mockResolvedValue(5);
    const r: any = await listDeals({});
    expect(r.total).toBe(5);
    expect(r.data).toHaveLength(1);
  });

  it("filtra por stage si se provee", async () => {
    (prisma.deal.findMany as any).mockResolvedValue([]);
    (prisma.deal.count as any).mockResolvedValue(0);
    await listDeals({ stage: "WON" });
    const call = (prisma.deal.findMany as any).mock.calls[0][0];
    expect(call.where.stage).toBe("WON");
  });
});

describe("getDealById", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404 si no existe", async () => {
    (prisma.deal.findUnique as any).mockResolvedValue(null);
    await expect(getDealById("missing")).rejects.toThrow(/no encontrado/i);
  });
});

describe("listQuotes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requiere dealId", async () => {
    await expect(listQuotes({})).rejects.toThrow();
  });

  it("devuelve quotes del deal", async () => {
    (prisma.quote.findMany as any).mockResolvedValue([{ id: "q1" }]);
    const r: any = await listQuotes({ dealId: "d1" });
    expect(r).toHaveLength(1);
  });
});

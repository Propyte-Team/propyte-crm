// GET /api/messages?contactId= (panel de conversación de la ficha del contacto). Hasta el
// 2026-10-12 devolvía los mensajes de cualquier contacto con solo tener sesión; ahora pasa por
// getContactAccessInfo (rol + marca), igual que la cronología.
import { describe, it, expect, vi, beforeEach } from "vitest";

const messageFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { message: { findMany: (...a: unknown[]) => messageFindMany(...a) } },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const getContactAccessInfo = vi.fn();
vi.mock("@/server/contacts", () => ({
  getContactAccessInfo: (...a: unknown[]) => getContactAccessInfo(...a),
}));

import { GET } from "./route";

const SESION = { user: { id: "u1", role: "GERENTE", plaza: "CANCUN" } };

function req(qs: string) {
  return new Request(`https://x/api/messages${qs}`) as never;
}

beforeEach(() => {
  for (const m of [messageFindMany, getServerSession, getContactAccessInfo]) m.mockReset();
  getServerSession.mockResolvedValue(SESION);
  messageFindMany.mockResolvedValue([]);
});

describe("GET /api/messages — acceso al contacto", () => {
  it("contacto de una marca que no ve (not_found) → 404 y no lee mensajes", async () => {
    getContactAccessInfo.mockResolvedValue({ ok: false, reason: "not_found" });
    const res = await GET(req("?contactId=k1"));
    expect(res.status).toBe(404);
    expect(messageFindMany).not.toHaveBeenCalled();
    expect(getContactAccessInfo).toHaveBeenCalledWith("k1", SESION);
  });

  it("fuera del alcance por rol (forbidden) → 403, mismo mapeo que la cronología", async () => {
    getContactAccessInfo.mockResolvedValue({ ok: false, reason: "forbidden" });
    const res = await GET(req("?contactId=k1"));
    expect(res.status).toBe(403);
    expect(messageFindMany).not.toHaveBeenCalled();
  });

  it("con acceso → lee los mensajes del contacto", async () => {
    getContactAccessInfo.mockResolvedValue({ ok: true, contact: { id: "k1" } });
    const res = await GET(req("?contactId=k1"));
    expect(res.status).toBe(200);
    expect(messageFindMany.mock.calls[0][0].where).toEqual({ contactId: "k1" });
  });

  it("sin contactId → 400 sin consultar el acceso", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
    expect(getContactAccessInfo).not.toHaveBeenCalled();
  });
});

// POST /api/me/whatsapp/posibles-prospectos/[id] (2026-10-14, coexistencia PR 2): «Es prospecto» /
// «Ignorar». La lógica se prueba en lib/whatsapp/coex/asesor.test.ts; aquí, la sesión, la acción y
// que el dueño sale de la sesión (nunca del cuerpo).
import { describe, it, expect, vi, beforeEach } from "vitest";

const session: { user: { id: string; role: string } | null } = { user: { id: "u-ana", role: "ASESOR" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session.user ? session : null) }));
const promotePendingProspect = vi.fn();
const ignorePendingProspect = vi.fn();
vi.mock("@/lib/whatsapp/coex/asesor", () => ({
  promotePendingProspect: (...a: unknown[]) => promotePendingProspect(...a),
  ignorePendingProspect: (...a: unknown[]) => ignorePendingProspect(...a),
}));

import { POST } from "./route";

const call = (body: unknown, id = "p-1") =>
  POST({ json: () => Promise.resolve(body) } as never, { params: Promise.resolve({ id }) });

beforeEach(() => {
  session.user = { id: "u-ana", role: "ASESOR" };
  promotePendingProspect.mockReset();
  promotePendingProspect.mockResolvedValue({ ok: true, status: "PROMOTED", contactId: "c-1", created: true });
  ignorePendingProspect.mockReset();
  ignorePendingProspect.mockResolvedValue({ ok: true, status: "IGNORED" });
});

describe("posibles prospectos — acciones del asesor", () => {
  it("«Es prospecto» con el usuario de la sesión", async () => {
    const res = await call({ action: "prospecto", userId: "u-otro" });
    expect(res.status).toBe(200);
    expect(promotePendingProspect).toHaveBeenCalledWith("p-1", "u-ana");
    expect((await res.json()).data).toMatchObject({ status: "PROMOTED", contactId: "c-1" });
  });

  it("«Ignorar»", async () => {
    expect((await call({ action: "ignorar" })).status).toBe(200);
    expect(ignorePendingProspect).toHaveBeenCalledWith("p-1", "u-ana");
  });

  it("de otro asesor → el 404 del módulo pasa tal cual", async () => {
    promotePendingProspect.mockResolvedValue({ ok: false, status: 404, error: "No encontrado" });
    expect((await call({ action: "prospecto" })).status).toBe(404);
  });

  it("acción inválida → 400; sin sesión → 401", async () => {
    expect((await call({ action: "borrar" })).status).toBe(400);
    session.user = null;
    expect((await call({ action: "ignorar" })).status).toBe(401);
    expect(ignorePendingProspect).not.toHaveBeenCalled();
  });
});

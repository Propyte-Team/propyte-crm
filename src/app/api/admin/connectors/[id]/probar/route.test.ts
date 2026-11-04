import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const findFirst = vi.fn();
const update = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { leadConnector: { findFirst: (...a: unknown[]) => findFirst(...a), update: (...a: unknown[]) => update(...a) } },
}));

const probarConector = vi.fn();
vi.mock("@/lib/connectors/probar", () => ({ probarConector: (...a: unknown[]) => probarConector(...a) }));

import { POST } from "./route";

const props = { params: Promise.resolve({ id: "c1" }) };
const call = () => POST({} as never, props);

beforeEach(() => {
  for (const m of [findFirst, update, probarConector]) m.mockReset();
  session.user.role = "ADMIN";
  findFirst.mockResolvedValue({ id: "c1", provider: "MESSENGER", config: {}, credentials: "x" });
  update.mockResolvedValue({});
});

describe("POST /api/admin/connectors/[id]/probar", () => {
  it("rol sin permiso → 403", async () => {
    session.user.role = "ASESOR";
    expect((await call()).status).toBe(403);
    expect(probarConector).not.toHaveBeenCalled();
  });
  it("cuenta inexistente → 404", async () => {
    findFirst.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });
  it("éxito: 200 y no escribe en el conector", async () => {
    probarConector.mockResolvedValue({ ok: true, detalle: "Conexión válida" });
    const res = await call();
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });
  it("fallo: 422 y sube errorCount con el error crudo", async () => {
    probarConector.mockResolvedValue({ ok: false, detalle: "caducó", error: "(#190) x" });
    const res = await call();
    expect(res.status).toBe(422);
    expect(update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { errorCount: { increment: 1 }, lastError: "(#190) x" },
    });
    expect((await res.json()).detalle).toBe("caducó");
  });
});

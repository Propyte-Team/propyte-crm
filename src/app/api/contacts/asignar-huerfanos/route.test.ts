// POST /api/contacts/asignar-huerfanos (2026-10-14, #883): la ruta solo valida la forma y traduce
// códigos; la lógica se prueba en server/orphan-leads.asignacion.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));
const asignarHuerfanosEnLote = vi.fn();
vi.mock("@/server/orphan-leads", () => ({
  MAX_ASIGNACION_POR_LOTE: 200,
  asignarHuerfanosEnLote: (...a: unknown[]) => asignarHuerfanosEnLote(...a),
}));

import { POST } from "./route";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const post = (body: unknown) =>
  POST(new Request("https://x/api/contacts/asignar-huerfanos", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => {
  vi.resetAllMocks();
  getServerSession.mockResolvedValue({ user: { id: "luis-1", role: "ADMIN" } });
});

describe("POST /api/contacts/asignar-huerfanos", () => {
  it("sin sesión → 401", async () => {
    getServerSession.mockResolvedValue(null);
    expect((await post({ contactIds: [uuid(1)], assigneeId: uuid(9) })).status).toBe(401);
    expect(asignarHuerfanosEnLote).not.toHaveBeenCalled();
  });

  it("🚨 más de 200 ids → 400 sin llamar al lote", async () => {
    const r = await post({ contactIds: Array.from({ length: 201 }, (_, i) => uuid(i)), assigneeId: uuid(999) });
    expect(r.status).toBe(400);
    expect(asignarHuerfanosEnLote).not.toHaveBeenCalled();
  });

  it("ids que no son uuid o sin destino → 400", async () => {
    expect((await post({ contactIds: ["x"], assigneeId: uuid(9) })).status).toBe(400);
    expect((await post({ contactIds: [uuid(1)] })).status).toBe(400);
    expect((await post({ contactIds: [], assigneeId: uuid(9) })).status).toBe(400);
    expect(asignarHuerfanosEnLote).not.toHaveBeenCalled();
  });

  it("pasa el actor de la sesión y devuelve el resultado del lote", async () => {
    const data = { ok: true, asignados: 2, yaEranSuyos: 0, fallidos: [], assignee: { id: uuid(9), name: "Pedro" } };
    asignarHuerfanosEnLote.mockResolvedValue(data);
    const r = await post({ contactIds: [uuid(1), uuid(2)], assigneeId: uuid(9) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ data });
    expect(asignarHuerfanosEnLote).toHaveBeenCalledWith({
      actor: { id: "luis-1", role: "ADMIN" },
      contactIds: [uuid(1), uuid(2)],
      assigneeId: uuid(9),
    });
  });

  it.each([
    ["sin-permiso", 403],
    ["usuario-invalido", 400],
    ["demasiados", 400],
    ["vacio", 400],
  ])("código %s → %i", async (code, status) => {
    asignarHuerfanosEnLote.mockResolvedValue({ ok: false, code });
    expect((await post({ contactIds: [uuid(1)], assigneeId: uuid(9) })).status).toBe(status);
  });

  it("si el lote truena → 500", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    asignarHuerfanosEnLote.mockRejectedValue(new Error("boom"));
    expect((await post({ contactIds: [uuid(1)], assigneeId: uuid(9) })).status).toBe(500);
    error.mockRestore();
  });
});

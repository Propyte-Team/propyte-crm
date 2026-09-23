import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryRaw = vi.fn();
vi.mock("@/lib/db", () => ({ default: { $queryRaw: (...a: unknown[]) => queryRaw(...a) } }));

import { GET } from "./route";

beforeEach(() => queryRaw.mockReset());
// vi.restoreAllMocks() en afterEach en vez de err.mockRestore() al final de cada test:
// llamar mockRestore() como último statement síncrono del test, con otro test antes en el
// archivo, dispara un falso "unhandled rejection" en esta versión de vitest/tinyspy —
// verificado aislando el repro (mockReset + spy + mockRestore inline = falla; lo mismo con
// la restauración movida a afterEach = pasa). No es un fallo real del código: la ruta
// atrapa el error correctamente (confirmado leyendo el stdout con el spy quitado).
afterEach(() => vi.restoreAllMocks());

describe("GET /api/health (#771)", () => {
  it("200 { ok: true, db: \"up\" } cuando SELECT 1 responde", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: "up" });
  });

  // El incidente real: el proceso vivo, /login en 200, pero el cliente de Prisma sin
  // resolver. Esta es la comprobación que ese día habría fallado desde el minuto uno.
  it("500 { ok: false, db: \"down\" } cuando la base no responde (ej. Prisma no resuelve)", async () => {
    queryRaw.mockImplementation(() => { throw new Error("Cannot find module '.prisma/client/default'"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, db: "down" });
  });

  it("no expone el detalle del error en la respuesta pública, solo en el log del servidor", async () => {
    queryRaw.mockImplementation(() => { throw new Error('password authentication failed for user "produccion"'); });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET();
    const text = await res.text();
    expect(text).not.toContain("password");
    expect(text).not.toContain("produccion");
    expect(err).toHaveBeenCalled();
  });

  it("no lanza aunque la consulta rechace (best-effort: siempre responde algo)", async () => {
    queryRaw.mockImplementation(() => { throw new Error("boom"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(GET()).resolves.toBeInstanceOf(Response);
  });
});

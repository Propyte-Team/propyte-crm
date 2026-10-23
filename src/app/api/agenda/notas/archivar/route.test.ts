import { describe, it, expect, vi, beforeEach } from "vitest";

const archiveMyNotes = vi.fn();

vi.mock("@/server/agenda", () => ({
  archiveMyNotes: (...a: unknown[]) => archiveMyNotes(...a),
  NOTES_ARCHIVE_MAX_IDS: 100,
}));

import { POST } from "./route";

function post(body: unknown) {
  return new Request("http://localhost/api/agenda/notas/archivar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  archiveMyNotes.mockReset();
  archiveMyNotes.mockResolvedValue({ archived: 1 });
});

describe("POST /api/agenda/notas/archivar (#924)", () => {
  it("archiva una nota", async () => {
    const res = await POST(post({ ids: ["n-1"] }));
    expect(res.status).toBe(200);
    expect(archiveMyNotes).toHaveBeenCalledWith({ ids: ["n-1"] });
    expect((await res.json()).data).toEqual({ archived: 1 });
  });

  it("archiva las seleccionadas", async () => {
    await POST(post({ ids: ["n-1", "n-2", "n-3"] }));
    expect(archiveMyNotes).toHaveBeenCalledWith({ ids: ["n-1", "n-2", "n-3"] });
  });

  it("archiva todas solo con { todas: true }", async () => {
    archiveMyNotes.mockResolvedValue({ archived: 45 });
    const res = await POST(post({ todas: true }));
    expect(res.status).toBe(200);
    expect(archiveMyNotes).toHaveBeenCalledWith({ todas: true });
  });

  it("un body vacío, inválido o ambiguo NO archiva nada (400)", async () => {
    const casos: unknown[] = [
      {},
      "no-es-json",
      { todas: false },
      { todas: "true" },
      { ids: [] },
      { ids: "n-1" },
      { ids: [""] },
      { ids: ["n-1"], todas: true },
      { ids: Array.from({ length: 101 }, (_, i) => `n-${i}`) },
    ];
    for (const body of casos) {
      const res = await POST(post(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(archiveMyNotes).not.toHaveBeenCalled();
  });

  it("sin sesión responde 401", async () => {
    archiveMyNotes.mockRejectedValue(new Error("No autorizado"));
    const res = await POST(post({ todas: true }));
    expect(res.status).toBe(401);
  });

  it("un error inesperado responde 500 sin filtrar el mensaje", async () => {
    archiveMyNotes.mockRejectedValue(new Error("connection reset"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({ ids: ["n-1"] }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Error interno del servidor");
  });
});

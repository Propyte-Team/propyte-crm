import { describe, it, expect, vi, beforeEach } from "vitest";

const getCitaNotas = vi.fn();
const addCitaNota = vi.fn();

vi.mock("@/server/agenda-notas", () => ({
  getCitaNotas: (...a: unknown[]) => getCitaNotas(...a),
  addCitaNota: (...a: unknown[]) => addCitaNota(...a),
}));

import { GET, POST } from "./route";

const props = { params: Promise.resolve({ id: "cita-1" }) };

function post(body: unknown) {
  return new Request("http://localhost/api/agenda/citas/cita-1/notas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const get = () => new Request("http://localhost/api/agenda/citas/cita-1/notas");

beforeEach(() => {
  getCitaNotas.mockReset().mockResolvedValue([]);
  addCitaNota.mockReset().mockResolvedValue({ id: "n-1", texto: "x", createdAt: "", autor: null });
});

describe("GET /api/agenda/citas/[id]/notas", () => {
  it("devuelve las notas de la cita", async () => {
    getCitaNotas.mockResolvedValue([{ id: "n-1", texto: "Pidió precios", createdAt: "2026-10-13T17:00:00.000Z", autor: "Ana" }]);
    const res = await GET(get(), props);
    expect(res.status).toBe(200);
    expect(getCitaNotas).toHaveBeenCalledWith("cita-1");
    expect((await res.json()).data).toHaveLength(1);
  });

  it("traduce errores a 401, 403 y 404", async () => {
    const casos: [string, number][] = [
      ["No autorizado", 401],
      ["No tienes permiso para ver las notas de esta actividad", 403],
      ["Reunión o llamada no encontrada", 404],
    ];
    for (const [msg, status] of casos) {
      getCitaNotas.mockRejectedValueOnce(new Error(msg));
      expect((await GET(get(), props)).status).toBe(status);
    }
  });
});

describe("POST /api/agenda/citas/[id]/notas", () => {
  it("agrega la nota con el texto recortado y responde 201", async () => {
    const res = await POST(post({ texto: "  Quiere visitar el showroom  " }), props);
    expect(res.status).toBe(201);
    expect(addCitaNota).toHaveBeenCalledWith("cita-1", "Quiere visitar el showroom");
  });

  it("rechaza una nota vacía o de puros espacios", async () => {
    expect((await POST(post({ texto: "" }), props)).status).toBe(400);
    expect((await POST(post({ texto: "   " }), props)).status).toBe(400);
    expect(addCitaNota).not.toHaveBeenCalled();
  });

  it("rechaza notas de más de 5000 caracteres y campos extra (strict)", async () => {
    expect((await POST(post({ texto: "a".repeat(5001) }), props)).status).toBe(400);
    expect((await POST(post({ texto: "ok", userId: "otro" }), props)).status).toBe(400);
    expect(addCitaNota).not.toHaveBeenCalled();
  });

  it("404 si la cita no existe o no es reunión o llamada", async () => {
    addCitaNota.mockRejectedValueOnce(new Error("Reunión o llamada no encontrada"));
    expect((await POST(post({ texto: "Hola" }), props)).status).toBe(404);
  });
});

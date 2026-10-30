import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const listarEtiquetas = vi.fn();
const crearEtiqueta = vi.fn();
vi.mock("@/lib/contacts/etiquetas", () => ({
  listarEtiquetas: () => listarEtiquetas(),
  crearEtiqueta: (...a: unknown[]) => crearEtiqueta(...a),
}));
const listarCampanas = vi.fn();
const crearCampana = vi.fn();
vi.mock("@/lib/contacts/campanas", () => ({
  listarCampanas: () => listarCampanas(),
  crearCampana: (...a: unknown[]) => crearCampana(...a),
}));

import * as etiquetas from "./etiquetas/route";
import * as campanas from "./campanas/route";

function post(body: unknown) {
  return new Request("https://x/api/catalogos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ASESOR = { user: { id: "a1", role: "ASESOR_JR" } };
const MARKETING = { user: { id: "m1", role: "MARKETING" } };

beforeEach(() => {
  [getServerSession, listarEtiquetas, crearEtiqueta, listarCampanas, crearCampana].forEach((m) => m.mockReset());
  getServerSession.mockResolvedValue(ASESOR);
  listarEtiquetas.mockResolvedValue([{ id: "t1", name: "HOT" }]);
  listarCampanas.mockResolvedValue([{ id: "c1", name: "Expo", kind: "EVENTO" }]);
});

describe("/api/catalogos/etiquetas (#936)", () => {
  it("GET sin sesión: 401", async () => {
    getServerSession.mockResolvedValue(null);
    expect((await etiquetas.GET()).status).toBe(401);
  });
  it("GET: lista y puedeCrear según el rol", async () => {
    expect(await (await etiquetas.GET()).json()).toEqual({ data: [{ id: "t1", name: "HOT" }], puedeCrear: true });
    getServerSession.mockResolvedValue(MARKETING);
    expect((await (await etiquetas.GET()).json()).puedeCrear).toBe(false);
  });
  it("POST de un asesor: 201 si es nueva, 200 si ya existía", async () => {
    crearEtiqueta.mockResolvedValue({ ok: true, creada: true, data: { id: "t2", name: "VIP" } });
    const res = await etiquetas.POST(post({ name: "VIP" }));
    expect(res.status).toBe(201);
    expect(crearEtiqueta).toHaveBeenCalledWith("VIP", "a1");
    crearEtiqueta.mockResolvedValue({ ok: true, creada: false, data: { id: "t1", name: "HOT" } });
    expect((await etiquetas.POST(post({ name: "hot" }))).status).toBe(200);
  });
  it("POST de un rol que no edita contactos: 403 sin crear", async () => {
    getServerSession.mockResolvedValue(MARKETING);
    expect((await etiquetas.POST(post({ name: "VIP" }))).status).toBe(403);
    expect(crearEtiqueta).not.toHaveBeenCalled();
  });
  it("POST inválido: 400", async () => {
    expect((await etiquetas.POST(post("no-json"))).status).toBe(400);
    expect((await etiquetas.POST(post({ name: "x", otra: 1 }))).status).toBe(400);
    crearEtiqueta.mockResolvedValue({ ok: false, error: "Escribe el nombre de la etiqueta" });
    const res = await etiquetas.POST(post({ name: "  " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Escribe el nombre de la etiqueta");
  });
});

describe("/api/catalogos/campanas (#937)", () => {
  it("GET: lista con tipo", async () => {
    const body = await (await campanas.GET()).json();
    expect(body.data[0]).toEqual({ id: "c1", name: "Expo", kind: "EVENTO" });
    expect(body.puedeCrear).toBe(true);
  });
  it("POST: pasa nombre, tipo y autor", async () => {
    crearCampana.mockResolvedValue({ ok: true, creada: true, data: { id: "c2", name: "Preventa", kind: "CAMPANA" } });
    const res = await campanas.POST(post({ name: "Preventa", kind: "CAMPANA" }));
    expect(res.status).toBe(201);
    expect(crearCampana).toHaveBeenCalledWith("Preventa", "CAMPANA", "a1");
  });
  it("POST de MARKETING: 403", async () => {
    getServerSession.mockResolvedValue(MARKETING);
    expect((await campanas.POST(post({ name: "x", kind: "EVENTO" }))).status).toBe(403);
  });
});

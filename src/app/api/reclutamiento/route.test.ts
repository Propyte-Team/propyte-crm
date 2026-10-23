import { describe, it, expect, vi, beforeEach } from "vitest";

// #926 — API de Reclutamiento: puerta por rol (datos personales), validación, borrado lógico y
// los CV (solo rutas de ESTE candidato, que ya estén en el bucket; quién borra).

const cand = { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
const file = { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
const users = { findMany: vi.fn() };
vi.mock("@/lib/db", () => {
  const wrap = (o: Record<string, (...a: unknown[]) => unknown>) =>
    Object.fromEntries(Object.keys(o).map((k) => [k, (...a: unknown[]) => o[k](...a)]));
  return {
    default: {
      get recruitCandidate() { return wrap(cand); },
      get recruitCandidateFile() { return wrap(file); },
      get user() { return wrap(users); },
      $transaction: async (ops: unknown[]) => Promise.all(ops),
    },
  };
});

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const existeArchivo = vi.fn();
const borrarArchivo = vi.fn();
const crearUrlDeSubida = vi.fn();
vi.mock("@/lib/storage/crm-attachments", () => ({
  existeArchivo: (...a: unknown[]) => existeArchivo(...a),
  borrarArchivo: (...a: unknown[]) => borrarArchivo(...a),
  crearUrlDeSubida: (...a: unknown[]) => crearUrlDeSubida(...a),
  firmarLectura: async (xs: Array<{ path: string }>) =>
    Object.fromEntries(xs.map((x) => [x.path, { ver: `https://s/${x.path}`, descargar: `https://s/${x.path}?download` }])),
}));

import { GET as LISTA, POST as ALTA } from "./route";
import { PATCH, DELETE as BAJA } from "./[id]/route";
import { GET as CVS, POST as CONFIRMAR, DELETE as BORRAR_CV } from "./[id]/files/route";
import { POST as UPLOAD_URL } from "./[id]/files/upload-url/route";
import { GET as ABRIR_CV } from "./[id]/files/[fileId]/route";

const C = "11111111-1111-4111-8111-111111111111";
const RUTA = `candidates/${C}/cv/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.pdf`;
const props = { params: Promise.resolve({ id: C }) };
const propsCv = { params: Promise.resolve({ id: C, fileId: "f1" }) };
const ses = (role: string, id = "u1") => ({ user: { id, role } });
const ARCHIVO = { fileName: "CV Ana.pdf", mimeType: "application/pdf", sizeBytes: 120_000 };

function req(method: string, body?: unknown, query = "") {
  return new Request(`https://x/api/reclutamiento${query}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const FILA_DB = {
  id: C, fullName: "Ana", age: null, email: null, phone: null, area: null, plaza: null, portfolioUrl: null, notes: null,
  stage: "RECIBIDO", source: "MANUAL", createdAt: new Date("2026-10-23T12:00:00Z"), files: [],
};

beforeEach(() => {
  for (const m of [...Object.values(cand), ...Object.values(file), users.findMany, getServerSession, existeArchivo, borrarArchivo, crearUrlDeSubida]) m.mockReset();
  getServerSession.mockResolvedValue(ses("GERENTE"));
  cand.findMany.mockResolvedValue([FILA_DB]);
  cand.findFirst.mockResolvedValue({ id: C, stage: "RECIBIDO", files: [] });
  cand.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...FILA_DB, ...data }));
  cand.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...FILA_DB, ...data }));
  file.create.mockResolvedValue({ id: "f1" });
  users.findMany.mockResolvedValue([]);
  existeArchivo.mockResolvedValue(true);
  borrarArchivo.mockResolvedValue(true);
  crearUrlDeSubida.mockResolvedValue({ signedUrl: "https://s/up", token: "t" });
});

describe("puerta por rol", () => {
  it("sin sesión 401; un asesor, marketing o team leader 403 en TODAS las rutas, sin tocar la base", async () => {
    getServerSession.mockResolvedValue(null);
    expect((await LISTA()).status).toBe(401);
    for (const role of ["ASESOR", "MARKETING", "TEAM_LEADER", "HOSTESS"]) {
      getServerSession.mockResolvedValue(ses(role));
      expect((await LISTA()).status, role).toBe(403);
      expect((await ALTA(req("POST", { fullName: "A" }))).status).toBe(403);
      expect((await PATCH(req("PATCH", { stage: "OFERTA" }), props)).status).toBe(403);
      expect((await BAJA(req("DELETE"), props)).status).toBe(403);
      expect((await CVS(req("GET"), props)).status).toBe(403);
      expect((await CONFIRMAR(req("POST", { ...ARCHIVO, path: RUTA }), props)).status).toBe(403);
      expect((await BORRAR_CV(req("DELETE", undefined, "?fileId=f1"), props)).status).toBe(403);
      expect((await UPLOAD_URL(req("POST", ARCHIVO), props)).status).toBe(403);
      expect((await ABRIR_CV(req("GET"), propsCv)).status).toBe(403);
    }
    expect(cand.findMany).not.toHaveBeenCalled();
    expect(cand.findFirst).not.toHaveBeenCalled();
    expect(file.findFirst).not.toHaveBeenCalled();
  });

  it("GERENTE lista y da de alta", async () => {
    const l = await LISTA();
    expect(l.status).toBe(200);
    expect((await l.json()).data[0]).toMatchObject({ id: C, fullName: "Ana", cvs: [] });
    const a = await ALTA(req("POST", { fullName: "Ana", age: "25", plaza: "TULUM" }));
    expect(a.status).toBe(201);
    expect(cand.create.mock.calls[0][0].data).toMatchObject({ fullName: "Ana", age: 25, plaza: "TULUM", stage: "RECIBIDO", source: "MANUAL", createdById: "u1" });
  });
});

describe("alta y edición", () => {
  it("rechaza datos inválidos con 400 y sin escribir", async () => {
    expect((await ALTA(req("POST", { fullName: "" }))).status).toBe(400);
    expect((await ALTA(req("POST", { fullName: "A", email: "x" }))).status).toBe(400);
    expect((await ALTA(req("POST", { fullName: "A", source: "CHAT" }))).status).toBe(400);
    expect(cand.create).not.toHaveBeenCalled();
  });

  it("cambiar la etapa sella stageChangedAt; corregir otro campo no", async () => {
    await PATCH(req("PATCH", { stage: "OFERTA" }), props);
    expect(cand.update.mock.calls[0][0].data).toMatchObject({ stage: "OFERTA", stageChangedAt: expect.any(Date) });
    await PATCH(req("PATCH", { notes: "llamar el lunes" }), props);
    expect(cand.update.mock.calls[1][0].data).toEqual({ notes: "llamar el lunes" });
  });

  it("candidato inexistente o eliminado → 404", async () => {
    cand.findFirst.mockResolvedValue(null);
    expect((await PATCH(req("PATCH", { stage: "OFERTA" }), props)).status).toBe(404);
  });

  it("tabla sin migrar (P2021): la lista responde vacía con aviso, el alta 503", async () => {
    cand.findMany.mockRejectedValue({ code: "P2021" });
    cand.create.mockRejectedValue({ code: "P2021" });
    expect(await (await LISTA()).json()).toEqual({ data: [], sinMigracion: true });
    expect((await ALTA(req("POST", { fullName: "A" }))).status).toBe(503);
  });
});

describe("eliminar candidato", () => {
  it("GERENTE no puede; DIRECTOR hace borrado lógico y quita sus CV del bucket", async () => {
    expect((await BAJA(req("DELETE"), props)).status).toBe(403);
    getServerSession.mockResolvedValue(ses("DIRECTOR", "d1"));
    cand.findFirst.mockResolvedValue({ id: C, files: [{ storagePath: RUTA }] });
    const r = await BAJA(req("DELETE"), props);
    expect(r.status).toBe(200);
    expect(cand.update.mock.calls[0][0]).toMatchObject({ where: { id: C }, data: { deletedById: "d1", deletedAt: expect.any(Date) } });
    expect(file.updateMany.mock.calls[0][0]).toMatchObject({ where: { candidateId: C, deletedAt: null }, data: { deletedById: "d1" } });
    expect(borrarArchivo).toHaveBeenCalledWith(RUTA);
  });
});

describe("CV", () => {
  it("upload-url: valida tipo y tamaño, y la ruta es del candidato", async () => {
    expect((await UPLOAD_URL(req("POST", { ...ARCHIVO, fileName: "foto.png", mimeType: "image/png" }), props)).status).toBe(422);
    expect((await UPLOAD_URL(req("POST", { ...ARCHIVO, sizeBytes: 11 * 1024 * 1024 }), props)).status).toBe(422);
    const r = await UPLOAD_URL(req("POST", ARCHIVO), props);
    expect(r.status).toBe(200);
    expect((await r.json()).data.path).toMatch(new RegExp(`^candidates/${C}/cv/[0-9a-f-]{36}\\.pdf$`));
  });

  it("confirmar: rechaza rutas ajenas o que no están en el bucket; registra MANUAL con quien subió", async () => {
    const ajena = `candidates/22222222-2222-4222-8222-222222222222/cv/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.pdf`;
    expect((await CONFIRMAR(req("POST", { ...ARCHIVO, path: ajena }), props)).status).toBe(400);
    existeArchivo.mockResolvedValueOnce(false);
    expect((await CONFIRMAR(req("POST", { ...ARCHIVO, path: RUTA }), props)).status).toBe(409);
    expect(file.create).not.toHaveBeenCalled();

    const r = await CONFIRMAR(req("POST", { ...ARCHIVO, path: RUTA }), props);
    expect(r.status).toBe(201);
    expect(file.create.mock.calls[0][0].data).toMatchObject({
      candidateId: C, storagePath: RUTA, fileName: "CV Ana.pdf", source: "MANUAL", sourceRef: null, uploadedById: "u1",
    });
  });

  it("confirmar dos veces la misma subida no duplica (P2002 → 409)", async () => {
    file.create.mockRejectedValue({ code: "P2002" });
    expect((await CONFIRMAR(req("POST", { ...ARCHIVO, path: RUTA }), props)).status).toBe(409);
  });

  it("borrar: quien lo subió sí; otro GERENTE no; DIRECTOR sí", async () => {
    file.findFirst.mockResolvedValue({ id: "f1", storagePath: RUTA, uploadedById: "otro" });
    expect((await BORRAR_CV(req("DELETE", undefined, "?fileId=f1"), props)).status).toBe(403);
    file.findFirst.mockResolvedValue({ id: "f1", storagePath: RUTA, uploadedById: "u1" });
    expect((await BORRAR_CV(req("DELETE", undefined, "?fileId=f1"), props)).status).toBe(200);
    getServerSession.mockResolvedValue(ses("DIRECTOR", "d1"));
    file.findFirst.mockResolvedValue({ id: "f1", storagePath: RUTA, uploadedById: "otro" });
    expect((await BORRAR_CV(req("DELETE", undefined, "?fileId=f1"), props)).status).toBe(200);
    expect(borrarArchivo).toHaveBeenCalledTimes(2);
  });

  it("abrir: redirige a una URL firmada recién hecha; con ?descargar=1 a la de descarga", async () => {
    file.findFirst.mockResolvedValue({ storagePath: RUTA, fileName: "cv.pdf" });
    const ver = await ABRIR_CV(req("GET"), propsCv);
    expect(ver.status).toBe(302);
    expect(ver.headers.get("location")).toBe(`https://s/${RUTA}`);
    const baja = await ABRIR_CV(req("GET", undefined, "?descargar=1"), propsCv);
    expect(baja.headers.get("location")).toBe(`https://s/${RUTA}?download`);
    expect(file.findFirst.mock.calls[0][0].where).toMatchObject({ id: "f1", candidateId: C, deletedAt: null, candidate: { deletedAt: null } });
  });
});

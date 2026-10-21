import { describe, it, expect, vi, beforeEach } from "vitest";

// #917 — API de los CV de la ficha: acceso al contacto, quién sube, quién borra, y que la
// confirmación solo registre archivos de ESTE contacto que de verdad están en el bucket.

const findMany = vi.fn();
const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contactFile: {
      findMany: (...a: unknown[]) => findMany(...a),
      findFirst: (...a: unknown[]) => findFirst(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const getContactAccessInfo = vi.fn();
vi.mock("@/server/contacts", () => ({ getContactAccessInfo: (...a: unknown[]) => getContactAccessInfo(...a) }));

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

import { GET, POST, DELETE } from "./route";
import { POST as UPLOAD_URL } from "./upload-url/route";

const C = "11111111-1111-4111-8111-111111111111";
const RUTA = `contacts/${C}/cv/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.pdf`;
const props = { params: Promise.resolve({ id: C }) };
const ASESOR = { user: { id: "u1", role: "ASESOR", plaza: "CANCUN" } };

function req(method: string, body?: unknown, query = "") {
  return new Request(`https://x/api/contacts/${C}/files${query}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const ARCHIVO = { fileName: "CV Ana.pdf", mimeType: "application/pdf", sizeBytes: 120_000 };

beforeEach(() => {
  [findMany, findFirst, create, update, getServerSession, getContactAccessInfo, existeArchivo, borrarArchivo, crearUrlDeSubida].forEach((m) =>
    m.mockReset()
  );
  getServerSession.mockResolvedValue(ASESOR);
  getContactAccessInfo.mockResolvedValue({ ok: true, contact: { id: C } });
  existeArchivo.mockResolvedValue(true);
  borrarArchivo.mockResolvedValue(true);
  crearUrlDeSubida.mockResolvedValue({ signedUrl: "https://s/up", token: "t" });
  create.mockResolvedValue({ id: "f1" });
});

describe("acceso", () => {
  it("sin sesión 401; sin acceso al contacto 403/404 en las cuatro rutas, sin tocar la base", async () => {
    getServerSession.mockResolvedValueOnce(null);
    expect((await GET(req("GET"), props)).status).toBe(401);

    getContactAccessInfo.mockResolvedValue({ ok: false, reason: "forbidden" });
    expect((await GET(req("GET"), props)).status).toBe(403);
    expect((await POST(req("POST", { ...ARCHIVO, path: RUTA }), props)).status).toBe(403);
    expect((await DELETE(req("DELETE", undefined, "?fileId=f1"), props)).status).toBe(403);
    expect((await UPLOAD_URL(req("POST", ARCHIVO), props)).status).toBe(403);

    getContactAccessInfo.mockResolvedValue({ ok: false, reason: "not_found" });
    expect((await GET(req("GET"), props)).status).toBe(404);

    expect(findMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(crearUrlDeSubida).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("lista los CV vivos del contacto, el más nuevo primero, con URLs y si se puede borrar", async () => {
    findMany.mockResolvedValue([
      { id: "f2", fileName: "nuevo.pdf", mimeType: "application/pdf", sizeBytes: 10, storagePath: "p2", createdAt: new Date(), uploadedById: "u1", uploadedBy: { name: "Felipe" } },
      { id: "f1", fileName: "viejo.docx", mimeType: "x", sizeBytes: 10, storagePath: "p1", createdAt: new Date(), uploadedById: "u9", uploadedBy: null },
    ]);
    const res = await GET(req("GET"), props);
    const body = await res.json();
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { contactId: C, kind: "CV", deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    expect(body.puedeSubir).toBe(true);
    expect(body.data.map((d: { id: string }) => d.id)).toEqual(["f2", "f1"]);
    expect(body.data[0]).toMatchObject({ verUrl: "https://s/p2", descargarUrl: "https://s/p2?download", uploadedByName: "Felipe", puedeBorrar: true });
    expect(body.data[1].puedeBorrar).toBe(false);
    expect(body.data[0]).not.toHaveProperty("storagePath");
  });

  it("sin la migración aplicada avisa en vez de tronar", async () => {
    findMany.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    const res = await GET(req("GET"), props);
    expect(res.status).toBe(503);
    expect((await res.json()).sinMigracion).toBe(true);
  });
});

describe("subir", () => {
  it("upload-url: valida el archivo y genera una ruta del contacto", async () => {
    const res = await UPLOAD_URL(req("POST", ARCHIVO), props);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.path).toMatch(new RegExp(`^contacts/${C}/cv/[0-9a-f-]{36}\\.pdf$`));
    expect(crearUrlDeSubida).toHaveBeenCalledWith(body.data.path);

    const malo = await UPLOAD_URL(req("POST", { fileName: "foto.png", mimeType: "image/png", sizeBytes: 10 }), props);
    expect(malo.status).toBe(422);
  });

  it("confirmar registra el archivo a nombre de quien lo subió", async () => {
    const res = await POST(req("POST", { ...ARCHIVO, path: RUTA }), props);
    expect(res.status).toBe(201);
    expect(create.mock.calls[0][0].data).toEqual({
      contactId: C, kind: "CV", fileName: "CV Ana.pdf", mimeType: "application/pdf", sizeBytes: 120_000, storagePath: RUTA, uploadedById: "u1",
    });
  });

  it("no registra rutas de otro contacto ni archivos que no llegaron al bucket", async () => {
    const otra = RUTA.replace(C, "22222222-2222-4222-8222-222222222222");
    expect((await POST(req("POST", { ...ARCHIVO, path: otra }), props)).status).toBe(400);
    existeArchivo.mockResolvedValueOnce(false);
    expect((await POST(req("POST", { ...ARCHIVO, path: RUTA }), props)).status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  it("Marketing y desarrollador externo ven, pero no suben", async () => {
    getServerSession.mockResolvedValue({ user: { id: "m1", role: "MARKETING", plaza: "CANCUN" } });
    expect((await UPLOAD_URL(req("POST", ARCHIVO), props)).status).toBe(403);
    expect((await POST(req("POST", { ...ARCHIVO, path: RUTA }), props)).status).toBe(403);
    findMany.mockResolvedValue([]);
    expect((await (await GET(req("GET"), props)).json()).puedeSubir).toBe(false);
  });
});

describe("borrar", () => {
  it("quien lo subió lo borra: marca borrado y quita el objeto del bucket", async () => {
    findFirst.mockResolvedValue({ id: "f1", storagePath: RUTA, uploadedById: "u1" });
    const res = await DELETE(req("DELETE", undefined, "?fileId=f1"), props);
    expect(res.status).toBe(200);
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: "f1", contactId: C, deletedAt: null });
    expect(update.mock.calls[0][0].data).toMatchObject({ deletedById: "u1" });
    expect(borrarArchivo).toHaveBeenCalledWith(RUTA);
  });

  it("otro asesor no; un Admin sí", async () => {
    findFirst.mockResolvedValue({ id: "f1", storagePath: RUTA, uploadedById: "u9" });
    expect((await DELETE(req("DELETE", undefined, "?fileId=f1"), props)).status).toBe(403);
    expect(update).not.toHaveBeenCalled();

    getServerSession.mockResolvedValue({ user: { id: "a1", role: "ADMIN", plaza: "CANCUN" } });
    expect((await DELETE(req("DELETE", undefined, "?fileId=f1"), props)).status).toBe(200);
  });

  it("un archivo de otro contacto (o ya borrado) es 404", async () => {
    findFirst.mockResolvedValue(null);
    expect((await DELETE(req("DELETE", undefined, "?fileId=fX"), props)).status).toBe(404);
  });
});

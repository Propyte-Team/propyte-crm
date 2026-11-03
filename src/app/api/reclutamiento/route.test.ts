import { describe, it, expect, vi, beforeEach } from "vitest";

// #926 — API de Reclutamiento: puerta por rol (datos personales), validación, borrado lógico y
// los CV (solo rutas de ESTE candidato, que ya estén en el bucket; quién borra).

const cand = { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() };
const file = { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() };
const users = { findMany: vi.fn() };
// #959: el alta manual busca o crea el contacto dentro de una transacción interactiva.
const contact = { findMany: vi.fn(), create: vi.fn(), update: vi.fn() };
const executeRaw = vi.fn();
vi.mock("@/lib/db", () => {
  const wrap = (o: Record<string, (...a: unknown[]) => unknown>) =>
    Object.fromEntries(Object.keys(o).map((k) => [k, (...a: unknown[]) => o[k](...a)]));
  const db: Record<string, unknown> = {
    get recruitCandidate() { return wrap(cand); },
    get recruitCandidateFile() { return wrap(file); },
    get user() { return wrap(users); },
    get contact() { return wrap(contact); },
    $executeRaw: (...a: unknown[]) => executeRaw(...a),
  };
  db.$transaction = async (x: unknown) =>
    typeof x === "function" ? (x as (tx: unknown) => unknown)(db) : Promise.all(x as unknown[]);
  return { default: db };
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
  for (const m of [...Object.values(cand), ...Object.values(file), ...Object.values(contact), executeRaw, users.findMany, getServerSession, existeArchivo, borrarArchivo, crearUrlDeSubida]) m.mockReset();
  getServerSession.mockResolvedValue(ses("GERENTE"));
  cand.findMany.mockResolvedValue([FILA_DB]);
  cand.findFirst.mockResolvedValue({ id: C, stage: "RECIBIDO", files: [] });
  cand.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...FILA_DB, ...data }));
  cand.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...FILA_DB, ...data }));
  cand.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ ...FILA_DB, ...create }));
  contact.findMany.mockResolvedValue([]);
  contact.create.mockResolvedValue({ id: "k-nuevo" });
  contact.update.mockResolvedValue({});
  executeRaw.mockResolvedValue(1);
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
    expect(cand.upsert.mock.calls[0][0].create).toMatchObject({ fullName: "Ana", age: 25, plaza: "TULUM", stage: "RECIBIDO", source: "MANUAL", createdById: "u1" });
  });
});

describe("alta y edición", () => {
  it("rechaza datos inválidos con 400 y sin escribir", async () => {
    expect((await ALTA(req("POST", { fullName: "" }))).status).toBe(400);
    expect((await ALTA(req("POST", { fullName: "A", email: "x" }))).status).toBe(400);
    expect((await ALTA(req("POST", { fullName: "A", source: "CHAT" }))).status).toBe(400);
    expect(cand.create).not.toHaveBeenCalled();
    expect(cand.upsert).not.toHaveBeenCalled();
    expect(contact.create).not.toHaveBeenCalled();
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
    cand.upsert.mockRejectedValue({ code: "P2021" });
    expect(await (await LISTA()).json()).toEqual({ data: [], sinMigracion: true });
    expect((await ALTA(req("POST", { fullName: "A" }))).status).toBe(503);
  });
});

describe("#959 — Reclutamiento y Contactos ligados", () => {
  it("alta de alguien nuevo: crea su contacto Empleo en «Derivado a RH» y liga la ficha a él", async () => {
    const a = await ALTA(req("POST", {
      fullName: "Jesús Rafael Torres Lizama", email: "jesus@x.mx", phone: "+52 999 453 3580", area: "Marketing · Diseñador", plaza: "MERIDA",
    }));
    expect(a.status).toBe(201);
    // Se buscó por correo y por los 10 últimos dígitos del teléfono, solo entre contactos vivos.
    expect(contact.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null, mergedIntoId: null,
      OR: [{ email: { equals: "jesus@x.mx", mode: "insensitive" } }, { phone: { endsWith: "9994533580" } }],
    });
    expect(contact.create.mock.calls[0][0].data).toEqual({
      firstName: "Jesús Rafael", lastName: "Torres Lizama", email: "jesus@x.mx", phone: "+529994533580",
      contactType: "EMPLEO", leadSource: "OTRO", leadSourceDetail: "Reclutamiento (alta manual)",
      appliedPosition: "Marketing · Diseñador", targetPlaza: "MERIDA", estado: "DERIVADO_A_RH", tags: ["reclutamiento"],
    });
    // Upsert por contacto: si el disparador ya creó la ficha, se llena con lo capturado.
    const up = cand.upsert.mock.calls[0][0];
    expect(up.where).toEqual({ contactId: "k-nuevo" });
    expect(up.create).toMatchObject({ contactId: "k-nuevo", fullName: "Jesús Rafael Torres Lizama", source: "MANUAL", createdById: "u1" });
    expect(up.update).toMatchObject({ fullName: "Jesús Rafael Torres Lizama", source: "MANUAL", deletedAt: null, stagePrevia: null });
    // La cronología del contacto queda firmada por quien dio de alta.
    expect(executeRaw).toHaveBeenCalled();
  });

  it("ubicación que no es plaza del CRM (Foráneo) no llena la plaza del contacto; sin teléfono queda vacío", async () => {
    await ALTA(req("POST", { fullName: "Ramón Granados", plaza: "FORANEO" }));
    // Sin correo ni teléfono no hay con qué cruzar: la única lectura de contactos es la del estado.
    expect(contact.findMany.mock.calls.map((c) => c[0].where)).toEqual([{ id: { in: ["k-nuevo"] }, deletedAt: null }]);
    expect(contact.create.mock.calls[0][0].data).toMatchObject({ firstName: "Ramón", lastName: "Granados", targetPlaza: null, phone: "" });
  });

  it("si ya es contacto (por teléfono), se liga sin crear otro; si no tenía tipo, queda Empleo", async () => {
    contact.findMany.mockResolvedValue([
      { id: "k-viejo", contactType: "LEAD_COMPRADOR", createdAt: new Date("2026-01-01") },
      { id: "k-empleo", contactType: null, createdAt: new Date("2026-02-01") },
    ]);
    cand.findFirst.mockResolvedValue(null);
    await ALTA(req("POST", { fullName: "Ana", phone: "9841112233" }));
    expect(contact.create).not.toHaveBeenCalled();
    expect(cand.upsert.mock.calls[0][0].where).toEqual({ contactId: "k-viejo" });
    // Un tipo elegido por alguien (Lead Comprador) no se cambia.
    expect(contact.update).not.toHaveBeenCalled();

    contact.findMany.mockResolvedValue([{ id: "k-sin-tipo", contactType: null, createdAt: new Date("2026-02-01") }]);
    await ALTA(req("POST", { fullName: "Ana", email: "ANA@x.mx" }));
    expect(contact.update).toHaveBeenCalledWith({ where: { id: "k-sin-tipo" }, data: { contactType: "EMPLEO" } });
  });

  it("entre varios contactos que coinciden gana el que ya es Empleo", async () => {
    contact.findMany.mockResolvedValue([
      { id: "k-viejo", contactType: "LEAD_COMPRADOR", createdAt: new Date("2026-01-01") },
      { id: "k-empleo", contactType: "EMPLEO", createdAt: new Date("2026-02-01") },
    ]);
    cand.findFirst.mockResolvedValue(null);
    await ALTA(req("POST", { fullName: "Ana", email: "ana@x.mx" }));
    expect(cand.upsert.mock.calls[0][0].where).toEqual({ contactId: "k-empleo" });
  });

  it("si su contacto ya tiene ficha viva en Reclutamiento → 409 con el nombre, sin escribir", async () => {
    contact.findMany.mockResolvedValue([{ id: "k1", contactType: "EMPLEO", createdAt: new Date() }]);
    cand.findFirst.mockResolvedValue({ fullName: "Luis Loría" });
    const r = await ALTA(req("POST", { fullName: "Luis", email: "luis@x.mx" }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("«Luis Loría»");
    expect(cand.upsert).not.toHaveBeenCalled();
    expect(contact.create).not.toHaveBeenCalled();
    expect(cand.findFirst.mock.calls[0][0].where).toEqual({ contactId: { in: ["k1"] }, deletedAt: null });
  });

  it("409 también si la ficha viva es de OTRO de los contactos que coinciden (la misma persona dos veces)", async () => {
    contact.findMany.mockResolvedValue([
      { id: "k-empleo", contactType: "EMPLEO", createdAt: new Date("2026-02-01") },
      { id: "k-con-ficha", contactType: "LEAD_COMPRADOR", createdAt: new Date("2026-01-01") },
    ]);
    cand.findFirst.mockImplementation(async ({ where }: { where: { contactId: { in: string[] } } }) =>
      where.contactId.in.includes("k-con-ficha") ? { fullName: "Ana Pérez" } : null
    );
    expect((await ALTA(req("POST", { fullName: "Ana", email: "ana@x.mx" }))).status).toBe(409);
    expect(cand.upsert).not.toHaveBeenCalled();
  });

  it("si leer el estado del contacto falla después del alta, el alta igual responde 201", async () => {
    contact.findMany.mockImplementation(async (a: { where: { OR?: unknown } }) => {
      if (a.where.OR) return [];
      throw new Error("db");
    });
    const r = await ALTA(req("POST", { fullName: "Ana", email: "ana@x.mx" }));
    expect(r.status).toBe(201);
    expect((await r.json()).data.contacto).toBeNull();
  });

  it("mover la etapa a mano limpia el descarte automático pendiente", async () => {
    await PATCH(req("PATCH", { stage: "FILTRO_CV" }), props);
    expect(cand.update.mock.calls[0][0].data).toMatchObject({ stage: "FILTRO_CV", stagePrevia: null });
  });

  it("la lista trae el estado del contacto; sin contacto o con el contacto borrado, null", async () => {
    cand.findMany.mockResolvedValue([
      { ...FILA_DB, id: "a", contactId: "k1" },
      { ...FILA_DB, id: "b", contactId: "k-borrado" },
      { ...FILA_DB, id: "c", contactId: null },
    ]);
    contact.findMany.mockResolvedValue([{ id: "k1", estado: "SIN_RESPUESTA" }]);
    const data = (await (await LISTA()).json()).data as Array<{ id: string; contacto: unknown }>;
    expect(contact.findMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ["k1", "k-borrado"] }, deletedAt: null }, select: { id: true, estado: true },
    });
    expect(data.map((d) => [d.id, d.contacto])).toEqual([
      ["a", { id: "k1", estado: "SIN_RESPUESTA" }], ["b", null], ["c", null],
    ]);
  });

  it("si la lectura de contactos falla, la lista sale igual sin la etiqueta", async () => {
    cand.findMany.mockResolvedValue([{ ...FILA_DB, contactId: "k1" }]);
    contact.findMany.mockRejectedValue(new Error("db"));
    const l = await LISTA();
    expect(l.status).toBe(200);
    expect((await l.json()).data[0].contacto).toBeNull();
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

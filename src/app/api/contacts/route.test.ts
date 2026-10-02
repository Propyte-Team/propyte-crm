import { describe, it, expect, vi, beforeEach } from "vitest";

// #830: el teléfono deja de ser obligatorio para crear/editar un contacto cuando
// hay un Usuario de WhatsApp (whatsappUserId/BSUID) — se exige al menos uno de los
// dos. Esta batería cubre: el nuevo campo, el relajamiento condicional de phone,
// los chequeos de duplicado (phone Y whatsappUserId, ambos exentos cuando vienen
// vacíos), y el guard de "al menos uno" tanto en POST (vía refine) como en PUT
// (a mano, porque PUT valida con `.partial()` y un ZodEffects no tiene `.partial()`).

const contactFindFirst = vi.fn();
const contactCreate = vi.fn();
const userFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findFirst: (...a: unknown[]) => contactFindFirst(...a),
      create: (...a: unknown[]) => contactCreate(...a),
    },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const resolveCoreFieldAccess = vi.fn();
const nonEditableKeys = vi.fn();
vi.mock("@/lib/metadata/core-fields", () => ({
  resolveCoreFieldAccess: (...a: unknown[]) => resolveCoreFieldAccess(...a),
  nonEditableKeys: (...a: unknown[]) => nonEditableKeys(...a),
}));

const withChangeSource = vi.fn();
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (...a: unknown[]) => withChangeSource(...a),
}));

vi.mock("@/lib/api/orden", () => ({
  ordenValidado: () => ({ orderBy: undefined, error: null }),
}));

import { POST, PUT } from "./route";

const SESSION_ADMIN = { user: { id: "u1", role: "ADMIN", plaza: "CANCUN" } };

function req(body: unknown, url = "https://x/api/contacts") {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const BASE_BODY = {
  firstName: "Karla",
  lastName: "Muñoz",
  leadSource: "WHATSAPP",
};

beforeEach(() => {
  [contactFindFirst, contactCreate, userFindUnique, getServerSession, resolveCoreFieldAccess, nonEditableKeys, withChangeSource]
    .forEach((m) => m.mockReset());
  getServerSession.mockResolvedValue(SESSION_ADMIN);
  contactFindFirst.mockResolvedValue(null); // sin duplicados por defecto
  contactCreate.mockResolvedValue({ id: "c1" });
  resolveCoreFieldAccess.mockResolvedValue({});
  nonEditableKeys.mockReturnValue(new Set());
  withChangeSource.mockImplementation((_opts, fn) => fn({ contact: { update: vi.fn().mockResolvedValue({ id: "c1" }) } }));
});

describe("POST /api/contacts — #830 teléfono opcional con Usuario de WhatsApp", () => {
  it("no-regresión: con teléfono y sin whatsappUserId, crea igual que siempre", async () => {
    const res = await POST(req({ ...BASE_BODY, phone: "+5219991112233" }));
    expect(res.status).toBe(201);
    expect(contactCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: "+5219991112233", whatsappUserId: null }) }),
    );
  });

  it("sin teléfono pero con whatsappUserId: crea con phone sentinel \"\" (nunca null, nunca inventado)", async () => {
    const res = await POST(req({ ...BASE_BODY, whatsappUserId: "MX.13491208655302741918" }));
    expect(res.status).toBe(201);
    expect(contactCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: "", whatsappUserId: "MX.13491208655302741918" }),
      }),
    );
  });

  it("sin teléfono y sin whatsappUserId: 400, nunca llega a crear", async () => {
    const res = await POST(req({ ...BASE_BODY }));
    expect(res.status).toBe(400);
    expect(contactCreate).not.toHaveBeenCalled();
  });

  it("teléfono con menos de 10 dígitos sigue rechazándose (la validación de formato no se perdió al volverse opcional)", async () => {
    const res = await POST(req({ ...BASE_BODY, phone: "123" }));
    expect(res.status).toBe(400);
    expect(contactCreate).not.toHaveBeenCalled();
  });

  it("duplicado por teléfono: sigue rechazando como antes", async () => {
    contactFindFirst.mockResolvedValueOnce({ id: "existente" }); // primer findFirst = chequeo de phone
    const res = await POST(req({ ...BASE_BODY, phone: "+5219991112233" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/teléfono/);
  });

  it("dos contactos solo-WhatsApp (ambos phone: \"\") NO se rechazan como duplicados entre sí", async () => {
    // contactFindFirst nunca se llama para phone vacío — solo para whatsappUserId, que aquí no choca.
    const res = await POST(req({ ...BASE_BODY, whatsappUserId: "MX.uno" }));
    expect(res.status).toBe(201);
    // Verifica que el chequeo de duplicado de teléfono no se ejecutó con phone vacío.
    expect(contactFindFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ phone: "" }) }),
    );
  });

  it("duplicado por whatsappUserId: 409 con mensaje específico (antes caía en el P2002 genérico)", async () => {
    contactFindFirst.mockResolvedValueOnce({ id: "existente" }); // chequeo de whatsappUserId (no hay phone, se salta ese chequeo)
    const res = await POST(req({ ...BASE_BODY, whatsappUserId: "MX.repetido" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/Usuario de WhatsApp/);
    expect(contactCreate).not.toHaveBeenCalled();
  });
});

describe("PUT /api/contacts?id=... — #830 mismo criterio en edición", () => {
  function put(body: unknown, existing: Record<string, unknown>) {
    contactFindFirst.mockResolvedValueOnce(existing); // "verificar que el contacto existe"
    return PUT(
      new Request("https://x/api/contacts?id=c1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }) as unknown as import("next/server").NextRequest,
    );
  }

  it("limpiar el teléfono (phone: \"\") cuando ya hay whatsappUserId guardado: permitido", async () => {
    const res = await put({ phone: "" }, { id: "c1", phone: "+5219991112233", whatsappUserId: "MX.1" });
    expect(res.status).toBe(200);
    expect(withChangeSource).toHaveBeenCalled();
  });

  it("limpiar el teléfono cuando NO hay whatsappUserId: 400, no llega a actualizar", async () => {
    const res = await put({ phone: "" }, { id: "c1", phone: "+5219991112233", whatsappUserId: null });
    expect(res.status).toBe(400);
    expect(withChangeSource).not.toHaveBeenCalled();
  });

  it("editar un campo no relacionado (p. ej. tags) en un contacto que YA tenía ambos vacíos: no bloquea (no se tocó phone ni whatsappUserId)", async () => {
    const res = await put({ tags: ["vip"] }, { id: "c1", phone: "", whatsappUserId: null });
    expect(res.status).toBe(200);
  });

  it("agregar whatsappUserId a un contacto sin teléfono: permitido, queda con ambos campos resueltos", async () => {
    const res = await put({ whatsappUserId: "MX.nuevo" }, { id: "c1", phone: "", whatsappUserId: null });
    expect(res.status).toBe(200);
  });

  it("limpiar whatsappUserId (\"\") guarda NULL, nunca cadena vacía (la columna es @unique)", async () => {
    let updateDataSeen: unknown;
    withChangeSource.mockImplementation((_opts, fn) =>
      fn({
        contact: {
          update: vi.fn((args) => {
            updateDataSeen = args.data;
            return Promise.resolve({ id: "c1" });
          }),
        },
      }),
    );
    const res = await put({ whatsappUserId: "" }, { id: "c1", phone: "+5219991112233", whatsappUserId: "MX.1" });
    expect(res.status).toBe(200);
    expect((updateDataSeen as Record<string, unknown>).whatsappUserId).toBeNull();
  });

  it("duplicado de whatsappUserId contra OTRO contacto: 409 específico", async () => {
    contactFindFirst
      .mockResolvedValueOnce({ id: "c1", phone: "+5219991112233", whatsappUserId: "MX.viejo" }) // existe
      .mockResolvedValueOnce({ id: "c2" }); // duplicado de whatsappUserId
    const res = await PUT(
      new Request("https://x/api/contacts?id=c1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappUserId: "MX.repetido" }),
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/Usuario de WhatsApp/);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// #949: «Empresa» del contacto. Al crear o editar un contacto se puede ligar a una empresa del
// módulo «Empresas». La empresa tiene que existir y no estar borrada; quitarla (null) no se
// comprueba. Cualquier rol con el campo editable puede ELEGIR una empresa (crearla es otra API).

const contactFindFirst = vi.fn();
const contactCreate = vi.fn();
const contactUpdate = vi.fn();
const empresaFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findFirst: (...a: unknown[]) => contactFindFirst(...a),
      create: (...a: unknown[]) => contactCreate(...a),
    },
    developerPartner: { findFirst: (...a: unknown[]) => empresaFindFirst(...a) },
    user: { findUnique: vi.fn() },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const nonEditableKeys = vi.fn();
vi.mock("@/lib/metadata/core-fields", () => ({
  resolveCoreFieldAccess: async () => ({}),
  nonEditableKeys: (...a: unknown[]) => nonEditableKeys(...a),
}));

vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_opts: unknown, fn: (tx: unknown) => unknown) =>
    fn({ contact: { update: (...a: unknown[]) => contactUpdate(...a) } }),
}));

vi.mock("@/server/contacts", () => ({ getContactAccessInfo: vi.fn() }));
vi.mock("@/lib/notificaciones/avisar-asignacion", () => ({ avisarAsignacion: vi.fn() }));

import { POST, PUT } from "./route";

const SESION = { user: { id: "u1", role: "ASESOR", plaza: "CANCUN" } };
const CONTACTO = "11111111-1111-4111-8111-111111111111";
const EMPRESA = "33333333-3333-4333-8333-333333333333";

function peticion(method: "POST" | "PUT", body: unknown) {
  const url = method === "PUT" ? `https://x/api/contacts?id=${CONTACTO}` : "https://x/api/contacts";
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const ALTA = { firstName: "Ana", lastName: "López", leadSource: "WHATSAPP", phone: "+5219991112233" };

beforeEach(() => {
  [contactFindFirst, contactCreate, contactUpdate, empresaFindFirst, getServerSession, nonEditableKeys].forEach((m) =>
    m.mockReset(),
  );
  getServerSession.mockResolvedValue(SESION);
  nonEditableKeys.mockReturnValue(new Set());
  contactCreate.mockResolvedValue({ id: "nuevo", firstName: "Ana", lastName: "López", assignedToId: "u1" });
  contactUpdate.mockResolvedValue({ id: CONTACTO, firstName: "Ana", lastName: "López" });
  contactFindFirst.mockImplementation(async (args: { where: { id?: string } }) =>
    args.where.id === CONTACTO ? { id: CONTACTO, phone: "+5219991112233", whatsappUserId: null, assignedToId: "u1" } : null,
  );
  empresaFindFirst.mockImplementation(async (args: { where: { id: string; deletedAt: null } }) =>
    args.where.id === EMPRESA && args.where.deletedAt === null ? { id: EMPRESA } : null,
  );
});

describe("POST /api/contacts con developerPartnerId (#949)", () => {
  it("con una empresa viva: el contacto nace ligado", async () => {
    const res = await POST(peticion("POST", { ...ALTA, developerPartnerId: EMPRESA }));
    expect(res.status).toBe(201);
    expect(contactCreate.mock.calls[0][0].data.developerPartnerId).toBe(EMPRESA);
  });

  it("sin empresa: nace sin empresa (null) y no se consulta nada", async () => {
    const res = await POST(peticion("POST", ALTA));
    expect(res.status).toBe(201);
    expect(contactCreate.mock.calls[0][0].data.developerPartnerId).toBeNull();
    expect(empresaFindFirst).not.toHaveBeenCalled();
  });

  it("empresa inexistente o borrada: 400 y no crea", async () => {
    const res = await POST(peticion("POST", { ...ALTA, developerPartnerId: "otra" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("La empresa elegida no existe");
    expect(json.fields).toEqual(["developerPartnerId"]);
    expect(contactCreate).not.toHaveBeenCalled();
  });
});

describe("PUT /api/contacts con developerPartnerId (#949)", () => {
  it("asignar: conecta la empresa", async () => {
    const res = await PUT(peticion("PUT", { developerPartnerId: EMPRESA }));
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data.developerPartner).toEqual({ connect: { id: EMPRESA } });
  });

  it("quitar (null): desconecta sin comprobar nada", async () => {
    const res = await PUT(peticion("PUT", { developerPartnerId: null }));
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data.developerPartner).toEqual({ disconnect: true });
    expect(empresaFindFirst).not.toHaveBeenCalled();
  });

  it("empresa inexistente: 400 y no guarda", async () => {
    const res = await PUT(peticion("PUT", { developerPartnerId: "otra" }));
    expect(res.status).toBe(400);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("editar otro campo no toca la empresa", async () => {
    const res = await PUT(peticion("PUT", { preferredZone: "Tulum" }));
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data).not.toHaveProperty("developerPartner");
  });

  it("si el rol tiene «Empresa» en solo lectura: 403", async () => {
    nonEditableKeys.mockReturnValue(new Set(["developerPartnerId"]));
    const res = await PUT(peticion("PUT", { developerPartnerId: EMPRESA }));
    expect(res.status).toBe(403);
    expect(contactUpdate).not.toHaveBeenCalled();
  });
});

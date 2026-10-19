import { describe, it, expect, vi, beforeEach } from "vitest";

// #907: «Referido por». Al crear o editar un contacto se puede ligar al broker que lo trajo.
// El broker tiene que existir, ser de tipo Broker, no ser el mismo contacto y estar al alcance
// de quien edita (misma puerta que abrir su ficha). Quitar la liga (null) no se comprueba.

const contactFindFirst = vi.fn();
const contactCreate = vi.fn();
const contactUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findFirst: (...a: unknown[]) => contactFindFirst(...a),
      create: (...a: unknown[]) => contactCreate(...a),
    },
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

const getContactAccessInfo = vi.fn();
vi.mock("@/server/contacts", () => ({
  getContactAccessInfo: (...a: unknown[]) => getContactAccessInfo(...a),
}));

import { POST, PUT } from "./route";

const SESION = { user: { id: "u1", role: "ASESOR", plaza: "CANCUN" } };
const CONTACTO = "11111111-1111-4111-8111-111111111111";
const BROKER = "22222222-2222-4222-8222-222222222222";

function peticion(method: "POST" | "PUT", body: unknown) {
  const url = method === "PUT" ? `https://x/api/contacts?id=${CONTACTO}` : "https://x/api/contacts";
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const ALTA = { firstName: "Ana", lastName: "López", leadSource: "WHATSAPP", phone: "+5219991112233" };

/** findFirst por id: el contacto que se edita, o el broker. Cualquier otro (duplicados) → null. */
function base(broker: { id: string; contactType: string | null } | null) {
  contactFindFirst.mockImplementation(async (args: { where: { id?: string } }) => {
    if (args.where.id === CONTACTO) return { id: CONTACTO, phone: "+5219991112233", whatsappUserId: null };
    if (args.where.id === BROKER) return broker;
    return null;
  });
}

beforeEach(() => {
  [contactFindFirst, contactCreate, contactUpdate, getServerSession, nonEditableKeys, getContactAccessInfo]
    .forEach((m) => m.mockReset());
  getServerSession.mockResolvedValue(SESION);
  nonEditableKeys.mockReturnValue(new Set());
  contactCreate.mockResolvedValue({ id: "nuevo" });
  contactUpdate.mockResolvedValue({ id: CONTACTO });
  getContactAccessInfo.mockResolvedValue({ ok: true, contact: { id: BROKER } });
  base({ id: BROKER, contactType: "BROKER_EXTERNO" });
});

describe("POST /api/contacts con referredById (#907)", () => {
  it("con un Broker al alcance: crea el contacto ya ligado", async () => {
    const res = await POST(peticion("POST", { ...ALTA, referredById: BROKER }));
    expect(res.status).toBe(201);
    expect(contactCreate.mock.calls[0][0].data.referredById).toBe(BROKER);
    // La puerta de acceso es la de la ficha, con la sesión de quien crea.
    expect(getContactAccessInfo).toHaveBeenCalledWith(BROKER, SESION);
  });

  it("sin referredById: nace sin broker (null), como siempre", async () => {
    const res = await POST(peticion("POST", ALTA));
    expect(res.status).toBe(201);
    expect(contactCreate.mock.calls[0][0].data.referredById).toBeNull();
    expect(getContactAccessInfo).not.toHaveBeenCalled();
  });

  it("si el elegido no es Broker: 400 y no crea", async () => {
    base({ id: BROKER, contactType: "COMPRADOR" });
    const res = await POST(peticion("POST", { ...ALTA, referredById: BROKER }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Solo se puede elegir un contacto de tipo Broker");
    expect(contactCreate).not.toHaveBeenCalled();
  });

  it("si el broker no existe (o está borrado): 400 «no existe»", async () => {
    base(null);
    const res = await POST(peticion("POST", { ...ALTA, referredById: BROKER }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("El broker elegido no existe");
    expect(contactCreate).not.toHaveBeenCalled();
  });

  it("si el broker está fuera del alcance de quien crea: MISMO 400 «no existe» (no confirma que exista)", async () => {
    getContactAccessInfo.mockResolvedValue({ ok: false, reason: "forbidden" });
    const res = await POST(peticion("POST", { ...ALTA, referredById: BROKER }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("El broker elegido no existe");
    expect(contactCreate).not.toHaveBeenCalled();
  });

  it("un id que no es uuid se rechaza en la validación", async () => {
    const res = await POST(peticion("POST", { ...ALTA, referredById: "no-es-uuid" }));
    expect(res.status).toBe(400);
    expect(contactCreate).not.toHaveBeenCalled();
  });
});

describe("PUT /api/contacts?id= con referredById (#907)", () => {
  it("liga al broker con connect", async () => {
    const res = await PUT(peticion("PUT", { referredById: BROKER }));
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data.referredBy).toEqual({ connect: { id: BROKER } });
  });

  it("null quita la liga con disconnect, sin buscar ningún broker", async () => {
    const res = await PUT(peticion("PUT", { referredById: null }));
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data.referredBy).toEqual({ disconnect: true });
    expect(getContactAccessInfo).not.toHaveBeenCalled();
  });

  it("si no viene referredById, la liga no se toca", async () => {
    const res = await PUT(peticion("PUT", { firstName: "Ana María" }));
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data).not.toHaveProperty("referredBy");
  });

  it("un contacto no puede ser referido por sí mismo: 400", async () => {
    base({ id: CONTACTO, contactType: "BROKER_EXTERNO" });
    const res = await PUT(peticion("PUT", { referredById: CONTACTO }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Un contacto no puede ser referido por sí mismo");
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("si el elegido no es Broker: 400 y no actualiza", async () => {
    base({ id: BROKER, contactType: null });
    const res = await PUT(peticion("PUT", { referredById: BROKER }));
    expect(res.status).toBe(400);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("con «Referido por» en solo lectura para el rol: 403 (la regla de campos core lo cubre)", async () => {
    nonEditableKeys.mockReturnValue(new Set(["referredById"]));
    const res = await PUT(peticion("PUT", { referredById: BROKER }));
    expect(res.status).toBe(403);
    expect(contactUpdate).not.toHaveBeenCalled();
  });
});

describe("Tipos de contacto en la API (#907)", () => {
  it("acepta Proveedor y Otro", async () => {
    for (const tipo of ["PROVEEDOR", "OTRO"]) {
      contactCreate.mockClear();
      const res = await POST(peticion("POST", { ...ALTA, contactType: tipo }));
      expect(res.status, tipo).toBe(201);
      expect(contactCreate.mock.calls[0][0].data.contactType).toBe(tipo);
    }
  });

  it("ya no acepta Referidor desde la UI (400)", async () => {
    const res = await POST(peticion("POST", { ...ALTA, contactType: "REFERIDOR" }));
    expect(res.status).toBe(400);
    expect(contactCreate).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// #914 — «Información adicional»: /api/contacts acepta y guarda empresa, Email 2, Facebook,
// mensaje inicial… al crear y al editar (la ficha edita en línea con PUT). Antes de este cambio
// zod descartaba esas claves en silencio y la API respondía 200 sin guardar nada.

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

vi.mock("@/server/contacts", () => ({ getContactAccessInfo: vi.fn() }));

import { POST, PUT } from "./route";

const SESION = { user: { id: "u1", role: "ASESOR", plaza: "CANCUN" } };
const CONTACTO = "11111111-1111-4111-8111-111111111111";

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
  [contactFindFirst, contactCreate, contactUpdate, getServerSession, nonEditableKeys].forEach((m) => m.mockReset());
  getServerSession.mockResolvedValue(SESION);
  nonEditableKeys.mockReturnValue(new Set());
  contactCreate.mockResolvedValue({ id: "nuevo" });
  contactUpdate.mockResolvedValue({ id: CONTACTO });
  contactFindFirst.mockImplementation(async (args: { where: { id?: string } }) =>
    args.where.id === CONTACTO ? { id: CONTACTO, phone: "+5219991112233", whatsappUserId: null } : null,
  );
});

describe("PUT /api/contacts — edición en línea de la ficha (#914)", () => {
  it("guarda la empresa que se escribe", async () => {
    const res = await PUT(peticion("PUT", { company: "Duke del Caribe" }));
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data.company).toBe("Duke del Caribe");
  });

  it("vaciar un campo lo guarda como null (sin dato), no como texto vacío", async () => {
    const res = await PUT(peticion("PUT", { facebook: "" }));
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data).toHaveProperty("facebook", null);
  });

  it("guarda el mensaje inicial con saltos de línea y el booleano de secuencia", async () => {
    const res = await PUT(peticion("PUT", { initialMessage: "Hola\nMe interesa Tulum", inSequence: false }));
    expect(res.status).toBe(200);
    const data = contactUpdate.mock.calls[0][0].data;
    expect(data.initialMessage).toBe("Hola\nMe interesa Tulum");
    expect(data.inSequence).toBe(false);
  });

  it("un Email 2 inválido se rechaza con 400 y no escribe", async () => {
    const res = await PUT(peticion("PUT", { secondaryEmail: "no-es-correo" }));
    expect(res.status).toBe(400);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("si el rol no puede editar el campo, 403 y no escribe", async () => {
    nonEditableKeys.mockReturnValue(new Set(["company"]));
    const res = await PUT(peticion("PUT", { company: "Otra" }));
    expect(res.status).toBe(403);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("editar otro campo no toca los adicionales", async () => {
    const res = await PUT(peticion("PUT", { nationality: "Mexicana" }));
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data).not.toHaveProperty("company");
  });
});

describe("POST /api/contacts (#914)", () => {
  it("crea el contacto con sus datos adicionales", async () => {
    const res = await POST(
      peticion("POST", { ...ALTA, company: "BROKER INDEPENDIENTE", secondaryEmail: "ana2@ejemplo.com" }),
    );
    expect(res.status).toBe(201);
    const data = contactCreate.mock.calls[0][0].data;
    expect(data.company).toBe("BROKER INDEPENDIENTE");
    expect(data.secondaryEmail).toBe("ana2@ejemplo.com");
  });

  it("sin datos adicionales, no manda ninguno (la base los deja en null)", async () => {
    const res = await POST(peticion("POST", ALTA));
    expect(res.status).toBe(201);
    expect(contactCreate.mock.calls[0][0].data).not.toHaveProperty("company");
  });
});

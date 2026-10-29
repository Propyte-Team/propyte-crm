import { describe, it, expect, vi, beforeEach } from "vitest";

// #948 — /api/contacts acepta y guarda el flujo (F1–F8) al crear y al editar en la ficha. Antes de
// este cambio zod descartaba la clave en silencio: la API respondía 200 y no guardaba nada.

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

describe("PUT /api/contacts — flujo desde la ficha (#948)", () => {
  it("guarda el flujo elegido", async () => {
    const res = await PUT(peticion("PUT", { flujo: "F2_CORRETAJE_COMPRADOR" }));
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data.flujo).toBe("F2_CORRETAJE_COMPRADOR");
  });

  it("«Sin flujo» se guarda como null", async () => {
    const res = await PUT(peticion("PUT", { flujo: null }));
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data).toHaveProperty("flujo", null);
  });

  it("un flujo que no existe se rechaza con 400 y no escribe", async () => {
    const res = await PUT(peticion("PUT", { flujo: "F9_INVENTADO" }));
    expect(res.status).toBe(400);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("si el rol no puede editar el flujo, 403 y no escribe", async () => {
    nonEditableKeys.mockReturnValue(new Set(["flujo"]));
    const res = await PUT(peticion("PUT", { flujo: "F5_NATIVA" }));
    expect(res.status).toBe(403);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("editar otro campo no toca el flujo", async () => {
    const res = await PUT(peticion("PUT", { nationality: "Mexicana" }));
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data).not.toHaveProperty("flujo");
  });
});

describe("POST /api/contacts — flujo al crear (#948)", () => {
  it("crea el contacto con el flujo elegido", async () => {
    const res = await POST(peticion("POST", { ...ALTA, flujo: "F7_INMOBILIARIA" }));
    expect(res.status).toBe(201);
    expect(contactCreate.mock.calls[0][0].data.flujo).toBe("F7_INMOBILIARIA");
  });

  it("sin flujo manda null: el disparador de la base lo llena según el tipo", async () => {
    const res = await POST(peticion("POST", ALTA));
    expect(res.status).toBe(201);
    expect(contactCreate.mock.calls[0][0].data.flujo).toBeNull();
  });
});

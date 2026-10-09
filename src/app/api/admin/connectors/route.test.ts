// POST /api/admin/connectors — WhatsApp (2026-10-09): el accessToken es obligatorio porque
// con él se responde y se descargan fotos y audios de ese número. Sin token el conector
// quedaría guardado pero mudo, así que se rechaza antes de tocar la base.
//
// brandId (2026-10-09): cada cuenta pertenece a una marca; el POST valida que exista y no esté
// borrada, y el GET devuelve brandId y { id, name } para que la UI muestre la marca.
import { describe, it, expect, vi, beforeEach } from "vitest";

const session = { user: { id: "u1", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const connectorCreate = vi.fn();
const connectorFindMany = vi.fn();
const brandFindFirst = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: {
      create: (...a: unknown[]) => connectorCreate(...a),
      findMany: (...a: unknown[]) => connectorFindMany(...a),
    },
    brand: { findFirst: (...a: unknown[]) => brandFindFirst(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

// Cifrar necesita la llave de PII del entorno; aquí solo importa si se intenta guardar.
vi.mock("@/lib/intake/connectors", () => ({ writeCredentials: () => "cifrado" }));

import { GET, POST } from "./route";

function req(body: unknown) {
  return { json: () => Promise.resolve(body) } as never;
}

const BRAND_ID = "3f2b8c1e-5d4a-4b6f-9c7e-1a2b3c4d5e6f";

const WA_OK = {
  name: "WhatsApp | Nativa",
  provider: "WHATSAPP",
  config: { phoneNumberId: "123" },
  credentials: { accessToken: "tok-test" },
};

beforeEach(() => {
  for (const m of [connectorCreate, connectorFindMany, brandFindFirst, auditCreate]) m.mockReset();
  session.user.role = "ADMIN";
  connectorCreate.mockResolvedValue({ id: "c1", name: WA_OK.name, provider: "WHATSAPP", status: "PAUSED" });
  auditCreate.mockResolvedValue({});
  connectorFindMany.mockResolvedValue([]);
  brandFindFirst.mockResolvedValue({ id: BRAND_ID });
});

describe("POST /api/admin/connectors · WHATSAPP", () => {
  it("sin accessToken → 400 y no guarda nada", async () => {
    const res = await POST(req({ ...WA_OK, credentials: undefined }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("accessToken requerido para WhatsApp");
    expect(connectorCreate).not.toHaveBeenCalled();
  });

  it("con credentials pero sin accessToken → 400", async () => {
    const res = await POST(req({ ...WA_OK, credentials: { otro: "x" } }));
    expect(res.status).toBe(400);
    expect(connectorCreate).not.toHaveBeenCalled();
  });

  it("sin phoneNumberId sigue respondiendo 400 por el ID", async () => {
    const res = await POST(req({ ...WA_OK, config: {} }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("phoneNumberId");
    expect(connectorCreate).not.toHaveBeenCalled();
  });

  it("con phoneNumberId y accessToken → 201 y queda en PAUSED", async () => {
    const res = await POST(req(WA_OK));
    expect(res.status).toBe(201);
    expect(connectorCreate).toHaveBeenCalledTimes(1);
    expect(connectorCreate.mock.calls[0][0].data.status).toBe("PAUSED");
  });
});

describe("POST /api/admin/connectors · brandId", () => {
  it("brandId inexistente o borrado → 400 'Marca no encontrada' y no guarda nada", async () => {
    brandFindFirst.mockResolvedValue(null);
    const res = await POST(req({ ...WA_OK, brandId: BRAND_ID }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Marca no encontrada");
    expect(brandFindFirst.mock.calls[0][0].where).toEqual({ id: BRAND_ID, deletedAt: null });
    expect(connectorCreate).not.toHaveBeenCalled();
  });

  it("brandId con formato inválido → 400 sin consultar la base", async () => {
    const res = await POST(req({ ...WA_OK, brandId: "no-es-uuid" }));
    expect(res.status).toBe(400);
    expect(brandFindFirst).not.toHaveBeenCalled();
    expect(connectorCreate).not.toHaveBeenCalled();
  });

  it("brandId válido → se guarda en la cuenta", async () => {
    const res = await POST(req({ ...WA_OK, brandId: BRAND_ID }));
    expect(res.status).toBe(201);
    expect(connectorCreate.mock.calls[0][0].data.brandId).toBe(BRAND_ID);
  });

  it("sin brandId no consulta marcas ni toca la columna (cuenta de la marca predeterminada)", async () => {
    const res = await POST(req(WA_OK));
    expect(res.status).toBe(201);
    expect(brandFindFirst).not.toHaveBeenCalled();
    expect("brandId" in connectorCreate.mock.calls[0][0].data).toBe(false);
  });

  it("brandId null → se guarda null sin consultar marcas", async () => {
    const res = await POST(req({ ...WA_OK, brandId: null }));
    expect(res.status).toBe(201);
    expect(brandFindFirst).not.toHaveBeenCalled();
    expect(connectorCreate.mock.calls[0][0].data.brandId).toBeNull();
  });
});

describe("GET /api/admin/connectors · brandId", () => {
  it("incluye brandId y brand { id, name } en el select y nunca devuelve las credenciales", async () => {
    connectorFindMany.mockResolvedValue([
      {
        id: "c1",
        name: "WhatsApp | Nativa",
        provider: "WHATSAPP",
        status: "PAUSED",
        brandId: BRAND_ID,
        brand: { id: BRAND_ID, name: "Nativa" },
        credentials: "cifrado",
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);

    const select = connectorFindMany.mock.calls[0][0].select;
    expect(select.brandId).toBe(true);
    expect(select.brand).toEqual({ select: { id: true, name: true } });

    const [row] = (await res.json()).data;
    expect(row.brandId).toBe(BRAND_ID);
    expect(row.brand).toEqual({ id: BRAND_ID, name: "Nativa" });
    expect(row.hasCredentials).toBe(true);
    expect("credentials" in row).toBe(false);
  });
});

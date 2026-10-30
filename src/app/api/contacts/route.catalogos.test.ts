import { describe, it, expect, vi, beforeEach } from "vitest";

// #936 etiquetas del catálogo y #937 campaña o evento en POST/PUT /api/contacts.

const contactFindFirst = vi.fn();
const contactCreate = vi.fn();
const contactUpdate = vi.fn();
const tagFindMany = vi.fn();
const campaignFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findFirst: (...a: unknown[]) => contactFindFirst(...a),
      create: (...a: unknown[]) => contactCreate(...a),
    },
    contactTag: { findMany: (...a: unknown[]) => tagFindMany(...a) },
    leadCampaign: { findFirst: (...a: unknown[]) => campaignFindFirst(...a) },
    user: { findUnique: vi.fn() },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));
vi.mock("@/lib/metadata/core-fields", () => ({
  resolveCoreFieldAccess: async () => ({}),
  nonEditableKeys: () => new Set(),
}));
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_o: unknown, fn: (tx: unknown) => unknown) =>
    fn({ contact: { update: (...a: unknown[]) => contactUpdate(...a) } }),
}));
vi.mock("@/lib/notificaciones/avisar-asignacion", () => ({ avisarAsignacion: async () => {} }));

import { POST, PUT } from "./route";

const SESION = { user: { id: "u1", role: "ASESOR", plaza: "CANCUN", name: "Ana" } };
const CONTACTO = "11111111-1111-4111-8111-111111111111";
const ALTA = { firstName: "Ana", lastName: "López", leadSource: "WHATSAPP", phone: "+5219991112233" };
const CATALOGO = [
  { name: "LEAD FRIO", nameKey: "lead frio" },
  { name: "HOT", nameKey: "hot" },
];

function peticion(method: "POST" | "PUT", body: unknown) {
  const url = method === "PUT" ? `https://x/api/contacts?id=${CONTACTO}` : "https://x/api/contacts";
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  [contactFindFirst, contactCreate, contactUpdate, tagFindMany, campaignFindFirst, getServerSession].forEach((m) =>
    m.mockReset(),
  );
  getServerSession.mockResolvedValue(SESION);
  contactCreate.mockResolvedValue({ id: "nuevo", firstName: "Ana", lastName: "López", assignedToId: "u1" });
  contactUpdate.mockResolvedValue({ id: CONTACTO });
  contactFindFirst.mockImplementation(async (args: { where: { id?: string } }) =>
    args.where.id === CONTACTO
      ? { id: CONTACTO, phone: "+5219991112233", whatsappUserId: null, tags: ["SPAM"], campaignId: "c-vieja" }
      : null,
  );
  tagFindMany.mockImplementation(async (args: { where: { nameKey: { in: string[] } } }) =>
    CATALOGO.filter((c) => args.where.nameKey.in.includes(c.nameKey)),
  );
  campaignFindFirst.mockImplementation(async (args: { where: { id: string } }) =>
    args.where.id === "c1" ? { id: "c1" } : null,
  );
});

describe("POST /api/contacts — etiquetas (#936)", () => {
  it("guarda las etiquetas como están en el catálogo («lead frío» → «LEAD FRIO»)", async () => {
    const res = await POST(peticion("POST", { ...ALTA, tags: ["lead frío", "hot"] }));
    expect(res.status).toBe(201);
    expect(contactCreate.mock.calls[0][0].data.tags).toEqual(["LEAD FRIO", "HOT"]);
  });

  it("una etiqueta fuera del catálogo: 400 y no crea", async () => {
    const res = await POST(peticion("POST", { ...ALTA, tags: ["Tulum"] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fields).toEqual(["tags"]);
    expect(body.error).toContain("«Tulum» no existe");
    expect(contactCreate).not.toHaveBeenCalled();
  });

  it("sin etiquetas: [] sin consultar el catálogo", async () => {
    await POST(peticion("POST", ALTA));
    expect(contactCreate.mock.calls[0][0].data.tags).toEqual([]);
    expect(tagFindMany).not.toHaveBeenCalled();
  });
});

describe("PUT /api/contacts — etiquetas (#936)", () => {
  it("respeta las que el contacto ya tenía aunque no estén en el catálogo (SPAM) y agrega del catálogo", async () => {
    const res = await PUT(peticion("PUT", { tags: ["SPAM", "hot"] }));
    expect(res.status).toBe(200);
    expect(contactUpdate.mock.calls[0][0].data.tags).toEqual(["SPAM", "HOT"]);
  });

  it("agregar una que no existe: 400 y no actualiza", async () => {
    const res = await PUT(peticion("PUT", { tags: ["SPAM", "Nueva"] }));
    expect(res.status).toBe(400);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("si no vienen tags, no se tocan", async () => {
    await PUT(peticion("PUT", { firstName: "Ana María" }));
    expect(contactUpdate.mock.calls[0][0].data).not.toHaveProperty("tags");
    expect(tagFindMany).not.toHaveBeenCalled();
  });
});

describe("campaña o evento (#937)", () => {
  it("POST con una campaña que existe: nace ligado", async () => {
    const res = await POST(peticion("POST", { ...ALTA, campaignId: "c1" }));
    expect(res.status).toBe(201);
    expect(contactCreate.mock.calls[0][0].data.campaignId).toBe("c1");
  });

  it("POST con una que no existe: 400", async () => {
    const res = await POST(peticion("POST", { ...ALTA, campaignId: "c-no" }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toEqual(["campaignId"]);
    expect(contactCreate).not.toHaveBeenCalled();
  });

  it("PUT liga con connect y quita con disconnect", async () => {
    await PUT(peticion("PUT", { campaignId: "c1" }));
    expect(contactUpdate.mock.calls[0][0].data.campaign).toEqual({ connect: { id: "c1" } });
    await PUT(peticion("PUT", { campaignId: null }));
    expect(contactUpdate.mock.calls[1][0].data.campaign).toEqual({ disconnect: true });
  });

  it("PUT con la misma que ya tenía (aunque esté archivada): no la vuelve a validar", async () => {
    const res = await PUT(peticion("PUT", { campaignId: "c-vieja" }));
    expect(res.status).toBe(200);
    expect(campaignFindFirst).not.toHaveBeenCalled();
  });

  it("PUT sin campaignId: no toca la campaña", async () => {
    await PUT(peticion("PUT", { firstName: "Ana María" }));
    expect(contactUpdate.mock.calls[0][0].data).not.toHaveProperty("campaign");
  });
});

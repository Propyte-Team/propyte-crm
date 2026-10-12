// Panel «Leads huérfanos» (2026-10-12, entrega 3 de marcas): consultas con prisma simulado.
import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.fn();
const contactCount = vi.fn();
const messageFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      count: (...a: unknown[]) => contactCount(...a),
    },
    message: { findMany: (...a: unknown[]) => messageFindMany(...a) },
  },
}));
const getVisibleBrands = vi.fn();
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: (...a: unknown[]) => getVisibleBrands(...a) }));

import { getOrphanLeads, countOrphanLeads } from "./orphan-leads";
import { unknownWhatsAppNumberReason } from "@/lib/messaging/unregistered-account";
import { BOT_SILENCE_PREFIX } from "@/lib/messaging/bot-note-prefix";

const SOLO_PROPYTE = { brandIds: ["b-def"], includesDefault: true };
const visibilidad = (u: string) => ({
  OR: [{ assignedToId: u }, { brands: { some: { brandId: { in: ["b-def"] } } } }, { brands: { none: {} } }],
});
const GERENTE = { id: "ger-1", role: "GERENTE" };

const NOTA_WA =
  `${BOT_SILENCE_PREFIX}: ` +
  unknownWhatsAppNumberReason({
    phoneNumberId: "1093",
    displayNumber: "+52 999 111 2222",
    lookupFailed: false,
    generalNumberConfigured: true,
  });

const contacto = {
  id: "k1",
  firstName: "Ana",
  lastName: "Pérez",
  leadSource: "WHATSAPP_DIRECTO",
  createdAt: new Date("2026-10-01T10:00:00Z"),
  brands: [{ brandId: "b-yax" }],
  assignedTo: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  getVisibleBrands.mockResolvedValue(SOLO_PROPYTE);
  contactFindMany.mockResolvedValue([]);
  contactCount.mockResolvedValue(0);
  messageFindMany.mockResolvedValue([]);
});

describe("getOrphanLeads — roles", () => {
  it("roles sin acceso → null sin consultar nada", async () => {
    for (const role of ["ASESOR_SR", "TEAM_LEADER", "HOSTESS", "BROKER", "MANTENIMIENTO"]) {
      expect(await getOrphanLeads({ id: "u", role })).toBeNull();
    }
    expect(getVisibleBrands).not.toHaveBeenCalled();
    expect(contactFindMany).not.toHaveBeenCalled();
  });

  it("MARKETING sí entra", async () => {
    expect(await getOrphanLeads({ id: "mkt-1", role: "MARKETING" })).not.toBeNull();
  });
});

describe("getOrphanLeads — (a) y (b)", () => {
  it("las dos listas y sus conteos van recortados por marca, del más nuevo al más viejo", async () => {
    await getOrphanLeads(GERENTE, { limit: 20 });
    expect(getVisibleBrands).toHaveBeenCalledWith(GERENTE);
    const [a, b] = contactFindMany.mock.calls.map((c) => c[0]);
    expect(a.where.assignedToId).toBeNull();
    expect(a.where.AND).toEqual([visibilidad("ger-1")]);
    expect(a.orderBy).toEqual({ createdAt: "desc" });
    expect(a.take).toBe(20);
    expect(b.where.assignedTo).toEqual({ is: { email: { endsWith: ".local" } } });
    expect(b.where.AND).toEqual([visibilidad("ger-1")]);
    const [ca, cb] = contactCount.mock.calls.map((c) => c[0]);
    expect(ca.where).toEqual(a.where);
    expect(cb.where).toEqual(b.where);
  });

  it("renglón: nombre, fuente, marcas, fechas en ISO y dueño", async () => {
    contactFindMany
      .mockResolvedValueOnce([{ ...contacto, messages: [{ createdAt: new Date("2026-10-02T12:00:00Z") }] }])
      .mockResolvedValueOnce([
        { ...contacto, id: "k2", assignedTo: { name: "Agentes", email: "agentes@propyte.local" }, messages: [] },
      ]);
    contactCount.mockResolvedValueOnce(1).mockResolvedValueOnce(90);
    const data = await getOrphanLeads(GERENTE);
    expect(data!.unowned).toEqual({
      total: 1,
      rows: [
        {
          id: "k1",
          name: "Ana Pérez",
          leadSource: "WHATSAPP_DIRECTO",
          createdAt: "2026-10-01T10:00:00.000Z",
          lastMessageAt: "2026-10-02T12:00:00.000Z",
          brandIds: ["b-yax"],
          owner: null,
        },
      ],
    });
    expect(data!.technical.total).toBe(90);
    expect(data!.technical.rows[0].owner).toEqual({ name: "Agentes", email: "agentes@propyte.local" });
    expect(data!.technical.rows[0].lastMessageAt).toBeNull();
  });
});

describe("getOrphanLeads — (c) cuenta sin registrar", () => {
  const nota = (id: string, conversationId: string) => ({
    id,
    body: NOTA_WA,
    createdAt: new Date("2026-10-11T09:00:00Z"),
    conversationId,
    conversation: { lastMessageAt: new Date("2026-10-11T09:00:00Z"), contact: contacto },
  });

  it("busca las notas con el alcance de la bandeja y la marca; solo la última nota interna cuenta", async () => {
    messageFindMany
      .mockResolvedValueOnce([nota("n1", "c1"), nota("n2", "c2")])
      // última nota interna de cada hilo: en c2 alguien escribió después
      .mockResolvedValueOnce([
        { id: "n1", conversationId: "c1" },
        { id: "n-asesor", conversationId: "c2" },
      ]);
    const data = await getOrphanLeads(GERENTE);

    const [busqueda, ultimas] = messageFindMany.mock.calls.map((c) => c[0]);
    expect(busqueda.where.internalNote).toBe(true);
    expect(busqueda.where.conversation.is.contact.AND).toEqual([visibilidad("ger-1")]);
    expect(busqueda.distinct).toEqual(["conversationId"]);
    expect(ultimas.where).toEqual({ conversationId: { in: ["c1", "c2"] }, internalNote: true });
    expect(ultimas.distinct).toEqual(["conversationId"]);

    expect(data!.unregistered.total).toBe(1);
    expect(data!.unregistered.rows).toEqual([
      {
        conversationId: "c1",
        contactId: "k1",
        name: "Ana Pérez",
        leadSource: "WHATSAPP_DIRECTO",
        createdAt: "2026-10-01T10:00:00.000Z",
        lastMessageAt: "2026-10-11T09:00:00.000Z",
        noteAt: "2026-10-11T09:00:00.000Z",
        account: { channel: "WHATSAPP", account: "+52 999 111 2222", accountId: "1093" },
        brandIds: ["b-yax"],
        owner: null,
      },
    ]);
  });

  it("sin notas no hace la segunda consulta", async () => {
    await getOrphanLeads(GERENTE);
    expect(messageFindMany).toHaveBeenCalledTimes(1);
  });

  it("ADMIN: sin recorte de marca en ninguna de las tres", async () => {
    getVisibleBrands.mockResolvedValue("ALL");
    await getOrphanLeads({ id: "adm-1", role: "ADMIN" });
    for (const c of contactFindMany.mock.calls) expect(c[0].where.AND).toBeUndefined();
    expect(messageFindMany.mock.calls[0][0].where.conversation.is.contact.AND).toBeUndefined();
  });
});

describe("countOrphanLeads", () => {
  it("suma las tres secciones sin traer renglones", async () => {
    contactCount.mockResolvedValueOnce(3).mockResolvedValueOnce(90);
    expect(await countOrphanLeads(GERENTE)).toBe(93);
    for (const c of contactFindMany.mock.calls) expect(c[0].take).toBe(0);
  });

  it("si algo falla, null (la página de Conexiones no se cae)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    contactCount.mockRejectedValue(new Error("db"));
    expect(await countOrphanLeads(GERENTE)).toBeNull();
  });

  it("rol sin acceso → null", async () => {
    expect(await countOrphanLeads({ id: "a", role: "ASESOR" })).toBeNull();
  });
});

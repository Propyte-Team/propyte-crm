// /api/me/whatsapp (2026-10-14, coexistencia PR 2): «Conectar mi WhatsApp». Lo que importa: cualquier
// rol conecta SU número (alcance ADVISOR, dueño = la sesión, sin marca); nadie se queda con el número
// de otro ni con uno de marca; el GET solo devuelve lo del propio usuario; y el token no sale nunca.
// Se ejercita el orquestador real contra Graph y Prisma falsos.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const session: { user: { id: string; role: string; name: string; email: string } | null } = {
  user: { id: "u-ana", role: "ASESOR", name: "Ana López", email: "ana@propyte.com" },
};
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session.user ? session : null) }));

const connectorFindFirst = vi.fn();
const connectorFindMany = vi.fn();
const connectorCreate = vi.fn();
const connectorUpdate = vi.fn();
const pendingFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: {
      findFirst: (...a: unknown[]) => connectorFindFirst(...a),
      findMany: (...a: unknown[]) => connectorFindMany(...a),
      create: (...a: unknown[]) => connectorCreate(...a),
      update: (...a: unknown[]) => connectorUpdate(...a),
    },
    whatsappPendingProspect: { findMany: (...a: unknown[]) => pendingFindMany(...a) },
    auditLog: { create: vi.fn(async () => ({})) },
    $executeRaw: vi.fn(async () => 1),
  },
}));
vi.mock("@/lib/intake/connectors", () => ({ writeCredentials: () => "cifrado", readCredentials: () => null }));

import { GET, POST } from "./route";

const TOKEN = "EAAGtokenDelAsesorAna123456789";
const CODE = "AQBcodigoDeAnaParaCanjear0001";
const WABA = "102290129340398";
const PNID = "106540352242922";

const fetchMock = vi.fn();
const req = (body: unknown) => ({ json: () => Promise.resolve(body) }) as never;

beforeEach(() => {
  session.user = { id: "u-ana", role: "ASESOR", name: "Ana López", email: "ana@propyte.com" };
  process.env.NEXT_PUBLIC_META_APP_ID = "1234567890";
  process.env.META_WA_APP_SECRET = "secreto-app";
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const u = String(url);
    const body = u.includes("/oauth/access_token")
      ? { access_token: TOKEN }
      : u.includes("/subscribed_apps")
        ? { success: true }
        : u.includes("/smb_app_data")
          ? { request_id: "r1" }
          : { id: PNID, display_phone_number: "+52 998 123 4567", verified_name: "Ana López Inmobiliaria", is_on_biz_app: true };
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  for (const m of [connectorFindFirst, connectorFindMany, connectorCreate, connectorUpdate, pendingFindMany]) m.mockReset();
  connectorFindFirst.mockResolvedValue(null);
  connectorCreate.mockImplementation(async (a: { data: { name: string; status: string } }) => ({ id: "conn-ana", name: a.data.name, status: a.data.status }));
  connectorUpdate.mockImplementation(async (a: { data: { status: string } }) => ({ id: "conn-ana", name: "WhatsApp de Ana López", status: a.data.status }));
  connectorFindMany.mockResolvedValue([]);
  pendingFindMany.mockResolvedValue([]);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/me/whatsapp — conectar MI número", () => {
  for (const role of ["ASESOR", "ASESOR_JR", "HOSTESS", "GERENTE", "ADMIN"]) {
    it(`${role} conecta su número como número de asesor, dueño = la sesión`, async () => {
      session.user!.role = role;
      const res = await POST(req({ code: CODE, wabaId: WABA, phoneNumberId: PNID }));
      expect(res.status).toBe(201);
      expect(connectorCreate.mock.calls[0][0].data).toMatchObject({
        name: "WhatsApp de Ana López",
        provider: "WHATSAPP",
        scope: "ADVISOR",
        ownerUserId: "u-ana",
        brandId: null,
        status: "ACTIVE",
      });
    });
  }

  it("sin sesión → 401 sin llamar a Meta", async () => {
    session.user = null;
    expect((await POST(req({ code: CODE, wabaId: WABA }))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("volver a conectar MI número → actualiza mi cuenta (idempotente)", async () => {
    connectorFindFirst.mockResolvedValue({ id: "conn-ana", name: "x", scope: "ADVISOR", ownerUserId: "u-ana", status: "ACTIVE", brandId: null, credentials: null, config: { phoneNumberId: PNID, coex: { accountState: "CONNECTED", contactsSync: { state: "REQUESTED" }, historySync: { state: "COMPLETE" } } } });
    const res = await POST(req({ code: CODE, wabaId: WABA, phoneNumberId: PNID }));
    expect(res.status).toBe(200);
    expect(connectorCreate).not.toHaveBeenCalled();
    expect(connectorUpdate.mock.calls[0][0].data).toMatchObject({ ownerUserId: "u-ana", brandId: null });
  });

  it("🚨 el número ya es de OTRO asesor → 409 sin tocar nada", async () => {
    connectorFindFirst.mockResolvedValue({ id: "conn-beto", name: "WhatsApp de Beto", scope: "ADVISOR", ownerUserId: "u-beto", status: "ACTIVE", brandId: null, credentials: null, config: { phoneNumberId: PNID } });
    const res = await POST(req({ code: CODE, wabaId: WABA, phoneNumberId: PNID }));
    expect(res.status).toBe(409);
    expect(connectorUpdate).not.toHaveBeenCalled();
  });

  it("🚨 el número es la línea de una marca → 409 (un asesor no se queda con el WhatsApp de la marca)", async () => {
    connectorFindFirst.mockResolvedValue({ id: "conn-yax", name: "WhatsApp · Yaxnáh", scope: "BRAND", ownerUserId: null, status: "ACTIVE", brandId: "b", credentials: null, config: { phoneNumberId: PNID } });
    const res = await POST(req({ code: CODE, wabaId: WABA, phoneNumberId: PNID }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/de una marca/);
  });

  it("🚨 el token no sale en la respuesta", async () => {
    const res = await POST(req({ code: CODE, wabaId: WABA, phoneNumberId: PNID }));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(CODE);
  });
});

describe("GET /api/me/whatsapp — solo lo mío", () => {
  it("busca solo mis números de asesor y mis posibles prospectos, sin config cruda", async () => {
    connectorFindMany.mockResolvedValue([
      { id: "conn-ana", name: "WhatsApp de Ana", status: "ACTIVE", lastError: null, createdAt: new Date(), config: { displayPhone: "+52 998 123 4567", verifiedName: "Ana", phoneNumberId: PNID, wabaId: WABA, coex: { accountState: "CONNECTED", historySync: { state: "IN_PROGRESS", progress: 40, at: "x" } } } },
    ]);
    pendingFindMany.mockResolvedValue([{ id: "p-1", phone: "+525550001111", profileName: "Juan", messageCount: 2 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(connectorFindMany.mock.calls[0][0].where).toEqual({ provider: "WHATSAPP", scope: "ADVISOR", ownerUserId: "u-ana", deletedAt: null });
    expect(pendingFindMany.mock.calls[0][0].where).toMatchObject({ ownerUserId: "u-ana", status: "PENDING" });
    const { data } = await res.json();
    expect(data.connectors[0]).toMatchObject({ displayPhone: "+52 998 123 4567", coex: { kind: "pending_sync" } });
    expect(data.connectors[0]).not.toHaveProperty("config");
    expect(data.pending).toHaveLength(1);
  });

  it("sin sesión → 401", async () => {
    session.user = null;
    expect((await GET()).status).toBe(401);
  });
});

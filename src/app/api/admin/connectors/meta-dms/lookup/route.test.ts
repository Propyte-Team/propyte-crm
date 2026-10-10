// POST /api/admin/connectors/meta-dms/lookup (2026-10-10): «Probar conexión» del asistente
// Meta DMs. Confirma que el token es de la Página escrita y propone el Instagram vinculado.
// No guarda nada; el token va a Graph en la cabecera y nunca vuelve en la respuesta.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const session = { user: { id: "u1", role: "MARKETING" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

import { POST } from "./route";

const TOKEN = "EAAtokenDeLaPaginaNativa123";
const IG_ID = "17841400000000001";
const req = (body: unknown) => ({ json: () => Promise.resolve(body) }) as never;
const call = (body: unknown = { pageId: "PAGE-1", pageAccessToken: TOKEN }) => POST(req(body));

type Reply = { status: number; body: unknown } | Error;
let graph: { me: Reply; ig: Reply };
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  session.user.role = "MARKETING";
  graph = {
    me: { status: 200, body: { id: "PAGE-1", name: "Nativa Tulum" } },
    ig: { status: 200, body: { id: "PAGE-1", instagram_business_account: { id: IG_ID, username: "nativatulum" } } },
  };
  fetchMock.mockImplementation(async (url: string) => {
    const r = String(url).endsWith("/me?fields=id,name") ? graph.me : graph.ig;
    if (r instanceof Error) throw r;
    return { ok: r.status < 400, status: r.status, json: () => Promise.resolve(r.body) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/admin/connectors/meta-dms/lookup", () => {
  it("token de la Página: devuelve la Página y su Instagram vinculado", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      pageId: "PAGE-1",
      pageName: "Nativa Tulum",
      instagram: { id: IG_ID, username: "nativatulum" },
      instagramError: null,
    });
  });

  it("el token va en la cabecera, nunca en la URL ni en la respuesta", async () => {
    const res = await call();
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain(TOKEN);
      expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    }
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
  });

  it("Página sin Instagram vinculado: instagram null, la prueba sigue siendo buena", async () => {
    graph.ig = { status: 200, body: { id: "PAGE-1" } };
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ instagram: null, instagramError: null });
  });

  it("si falla la consulta del Instagram, el token sigue probado y se informa", async () => {
    graph.ig = { status: 403, body: { error: { code: 10, message: "Permission denied" } } };
    const res = await call();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.instagram).toBeNull();
    expect(data.instagramError).toContain("No se pudo consultar el Instagram vinculado");
  });

  it("token de otra Página → 400 y no pregunta por el Instagram", async () => {
    graph.me = { status: 200, body: { id: "PAGE-9", name: "Yaxnáh" } };
    const res = await call();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("«Yaxnáh» (PAGE-9)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Meta rechaza el token → 400 sin repetirlo; Meta no contesta → 502", async () => {
    graph.me = { status: 400, body: { error: { code: 190, message: `Malformed access token ${TOKEN}` } } };
    const rejected = await call();
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(await rejected.json())).not.toContain(TOKEN);

    graph.me = new Error("connect ECONNREFUSED");
    expect((await call()).status).toBe(502);
  });

  it("datos incompletos → 400 sin llamar a Meta", async () => {
    const res = await call({ pageId: "PAGE-1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Pega el Page Access Token");
    expect((await call({ pageId: "PAGE 1", pageAccessToken: TOKEN })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["ASESOR", "BROKER", "TEAM_LEADER"])("%s → 403 sin llamar a Meta", async (role) => {
    session.user.role = role;
    expect((await call()).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"])("%s → 200", async (role) => {
    session.user.role = role;
    expect((await call()).status).toBe(200);
  });
});

// POST /api/admin/connectors/meta-dms (2026-10-10): alta conjunta de Messenger + Instagram de
// una Página. Lo que importa: que salgan las dos cuentas o ninguna (una transacción), con los
// mismos datos compartidos; que no se escriba nada si el token es de otra Página, si el IG no
// es el vinculado o si ya existe la cuenta; que la suscripción fallida no tumbe el alta; y que
// ni el token ni el App Secret salgan en la respuesta o en un log.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const session = { user: { id: "u1", role: "MARKETING" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const connectorCreate = vi.fn();
const connectorFindMany = vi.fn();
const brandFindFirst = vi.fn();
const auditCreate = vi.fn();
const transaction = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: {
      create: (...a: unknown[]) => connectorCreate(...a),
      findMany: (...a: unknown[]) => connectorFindMany(...a),
    },
    brand: { findFirst: (...a: unknown[]) => brandFindFirst(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));

// Cifrar de verdad necesita la llave de PII del entorno; aquí basta ver qué se cifraría.
const writeCreds = vi.fn();
vi.mock("@/lib/intake/connectors", () => ({
  writeCredentials: (...a: unknown[]) => writeCreds(...a),
}));

import { POST } from "./route";

const TOKEN = "EAAtokenDeLaPaginaNativa123";
const APP_SECRET = "app-secret-super-privado";
const VERIFY = "verify-nativa";
const BRAND_ID = "3f2b8c1e-5d4a-4b6f-9c7e-1a2b3c4d5e6f";
const IG_ID = "17841400000000001";

const BODY = {
  name: "Nativa Tulum",
  brandId: BRAND_ID,
  includeInstagram: true,
  fields: {
    pageId: "PAGE-1",
    brand: "Nativa",
    pageAccessToken: TOKEN,
    appSecret: APP_SECRET,
    verifyToken: VERIFY,
    igBusinessId: IG_ID,
  },
};

const req = (body: unknown) => ({ json: () => Promise.resolve(body) }) as never;
const call = (body: unknown = BODY) => POST(req(body));
const withFields = (fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  ...BODY,
  ...extra,
  fields: { ...BODY.fields, ...fields },
});

// Respuestas de Graph por endpoint. Cada prueba cambia solo lo que le importa.
type Reply = { status: number; body: unknown };
let graph: { me: Reply; ig: Reply; subGet: Reply[]; subPost: Reply };
const fetchMock = vi.fn();
const reply = (r: Reply) => ({ ok: r.status < 400, status: r.status, json: () => Promise.resolve(r.body) });
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));
const subscribeCalls = () =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes("/subscribed_apps") && c[1]?.method === "POST");

const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  for (const m of [connectorCreate, connectorFindMany, brandFindFirst, auditCreate, transaction, writeCreds, fetchMock]) m.mockReset();
  session.user.role = "MARKETING";
  brandFindFirst.mockResolvedValue({ id: BRAND_ID });
  connectorFindMany.mockResolvedValue([]);
  let n = 0;
  connectorCreate.mockImplementation((args: { data: { name: string; provider: string; status: string } }) =>
    Promise.resolve({ id: `c${++n}`, name: args.data.name, provider: args.data.provider, status: args.data.status })
  );
  transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  auditCreate.mockResolvedValue({});
  let blob = 0;
  writeCreds.mockImplementation(() => `v1:blob-${++blob}`);

  graph = {
    me: { status: 200, body: { id: "PAGE-1", name: "Nativa Tulum" } },
    ig: { status: 200, body: { id: "PAGE-1", instagram_business_account: { id: IG_ID, username: "nativatulum" } } },
    subGet: [
      { status: 200, body: { data: [{ subscribed_fields: ["leadgen"] }] } },
      { status: 200, body: { data: [{ subscribed_fields: ["leadgen", "messages", "message_echoes", "feed"] }] } },
    ],
    subPost: { status: 200, body: { success: true } },
  };
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/me?fields=id,name")) return reply(graph.me);
    if (u.includes("?fields=instagram_business_account")) return reply(graph.ig);
    if (u.includes("/subscribed_apps") && init?.method === "POST") return reply(graph.subPost);
    if (u.includes("/subscribed_apps")) return reply(graph.subGet.shift() ?? { status: 200, body: { data: [] } });
    throw new Error(`URL inesperada: ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    consoleSpies.push(vi.spyOn(console, level).mockImplementation(() => {}));
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (consoleSpies.length) consoleSpies.pop()!.mockRestore();
});

function expectNothingCreated() {
  expect(transaction).not.toHaveBeenCalled();
  expect(connectorCreate).not.toHaveBeenCalled();
  expect(writeCreds).not.toHaveBeenCalled();
  expect(subscribeCalls()).toHaveLength(0);
}

describe("POST /api/admin/connectors/meta-dms · alta", () => {
  it("crea Messenger e Instagram en UNA transacción con los mismos datos compartidos", async () => {
    const res = await call();
    expect(res.status).toBe(201);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0]).toHaveLength(2);
    expect(connectorCreate).toHaveBeenCalledTimes(2);

    const [messenger, instagram] = connectorCreate.mock.calls.map((c) => c[0].data);
    expect(messenger).toEqual({
      name: "Messenger | DM Nativa Tulum",
      provider: "MESSENGER",
      status: "ACTIVE",
      credentials: "v1:blob-1",
      config: { pageId: "PAGE-1", brand: "Nativa" },
      fieldMap: {},
      brandId: BRAND_ID,
    });
    expect(instagram).toEqual({
      name: "IG - Nativa Tulum",
      provider: "INSTAGRAM",
      status: "ACTIVE",
      credentials: "v1:blob-2",
      config: { pageId: "PAGE-1", igBusinessId: IG_ID, brand: "Nativa" },
      fieldMap: {},
      brandId: BRAND_ID,
    });

    // Las dos se cifran con los mismos secretos; el igBusinessId no entra en las credenciales.
    const secrets = { pageAccessToken: TOKEN, appSecret: APP_SECRET, verifyToken: VERIFY };
    expect(writeCreds.mock.calls.map((c) => c[0])).toEqual([secrets, secrets]);

    const { data } = await res.json();
    expect(data.connectors).toEqual([
      { id: "c1", name: "Messenger | DM Nativa Tulum", provider: "MESSENGER", status: "ACTIVE" },
      { id: "c2", name: "IG - Nativa Tulum", provider: "INSTAGRAM", status: "ACTIVE" },
    ]);
    expect(data.page).toEqual({ id: "PAGE-1", name: "Nativa Tulum" });
    expect(data.instagram).toEqual({ id: IG_ID, username: "nativatulum" });
    expect(auditCreate).toHaveBeenCalledTimes(2);
  });

  it("solo Messenger si se desmarca Instagram: no pregunta por el IG ni crea esa cuenta", async () => {
    const res = await call({ ...BODY, includeInstagram: false });
    expect(res.status).toBe(201);
    expect(connectorCreate).toHaveBeenCalledTimes(1);
    expect(connectorCreate.mock.calls[0][0].data).toMatchObject({
      name: "Messenger | DM Nativa Tulum",
      provider: "MESSENGER",
      config: { pageId: "PAGE-1", brand: "Nativa" },
    });
    expect(urls().some((u) => u.includes("instagram_business_account"))).toBe(false);
    expect(connectorFindMany.mock.calls[0][0].where).toEqual({ provider: { in: ["MESSENGER"] }, deletedAt: null });
    expect((await res.json()).data.instagram).toBeNull();
  });

  it("sin brandId no toca la columna (marca predeterminada) ni consulta marcas", async () => {
    const { brandId: _omit, ...sinMarca } = BODY;
    expect((await call(sinMarca)).status).toBe(201);
    expect(brandFindFirst).not.toHaveBeenCalled();
    for (const c of connectorCreate.mock.calls) expect("brandId" in c[0].data).toBe(false);
  });

  it("usa el nombre del admin aunque lo pegue con prefijo", async () => {
    await call({ ...BODY, name: "  IG - Nativa Tulum " });
    expect(connectorCreate.mock.calls.map((c) => c[0].data.name)).toEqual([
      "Messenger | DM Nativa Tulum",
      "IG - Nativa Tulum",
    ]);
  });

  it("pregunta a Meta con el token en la cabecera, nunca en la URL", async () => {
    await call();
    expect(fetchMock).toHaveBeenCalled();
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain(TOKEN);
      expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });
});

describe("POST /api/admin/connectors/meta-dms · rechazos (no se crea nada)", () => {
  it("token de otra Página → 400 diciendo de cuál es", async () => {
    graph.me = { status: 200, body: { id: "PAGE-9", name: "Yaxnáh" } };
    const res = await call();
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain("«Yaxnáh» (PAGE-9)");
    expect(error).toContain("PAGE-1");
    expectNothingCreated();
  });

  it("Meta rechaza el token → 400; Meta no contesta → 502", async () => {
    graph.me = { status: 400, body: { error: { code: 190, message: "Error validating access token" } } };
    const rejected = await call();
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toContain("Meta rechazó el token");

    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const down = await call();
    expect(down.status).toBe(502);
    expectNothingCreated();
  });

  it("igBusinessId que no es el vinculado a la Página → 400 con el @usuario correcto", async () => {
    const res = await call(withFields({ igBusinessId: "IG-OTRO" }));
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain("IG-OTRO");
    expect(error).toContain(`@nativatulum (${IG_ID})`);
    expectNothingCreated();
  });

  it("Página sin Instagram vinculado → 400 y sugiere desmarcar", async () => {
    graph.ig = { status: 200, body: { id: "PAGE-1" } };
    const res = await call();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("no tiene una cuenta de Instagram Business vinculada");
    expectNothingCreated();
  });

  it("no se puede consultar el Instagram → no se crea ni el Messenger", async () => {
    graph.ig = { status: 403, body: { error: { code: 10, message: "Permission denied" } } };
    const res = await call();
    expect(res.status).toBe(400);
    expectNothingCreated();
  });

  it("Instagram incluido sin igBusinessId → 400 sin llamar a Meta", async () => {
    const res = await call(withFields({ igBusinessId: "  " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Falta el Instagram Business ID");
    expect(fetchMock).not.toHaveBeenCalled();
    expectNothingCreated();
  });

  it("ya existe un Messenger vivo para esa Página → 409 nombrándolo, sin llamar a Meta", async () => {
    connectorFindMany.mockResolvedValue([
      { id: "m0", name: "Messenger | DM Nativa", provider: "MESSENGER", config: { pageId: "PAGE-1" } },
    ]);
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("«Messenger | DM Nativa»");
    expect(connectorFindMany.mock.calls[0][0].where).toEqual({
      provider: { in: ["MESSENGER", "INSTAGRAM"] },
      deletedAt: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expectNothingCreated();
  });

  it("ya existe el Instagram de esa Página → 409 y sugiere crear solo Messenger", async () => {
    connectorFindMany.mockResolvedValue([
      { id: "i0", name: "IG - Nativa", provider: "INSTAGRAM", config: { pageId: "PAGE-1", igBusinessId: IG_ID } },
    ]);
    const res = await call();
    expect(res.status).toBe(409);
    const { error } = await res.json();
    expect(error).toContain("«IG - Nativa»");
    expect(error).toContain("Desmarca «Incluir Instagram»");
    expectNothingCreated();
  });

  it("un Messenger de OTRA Página no estorba", async () => {
    connectorFindMany.mockResolvedValue([
      { id: "m9", name: "Messenger | DM Yaxnah", provider: "MESSENGER", config: { pageId: "PAGE-9" } },
    ]);
    expect((await call()).status).toBe(201);
  });

  it("marca inexistente o borrada → 400 sin llamar a Meta", async () => {
    brandFindFirst.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Marca no encontrada");
    expect(brandFindFirst.mock.calls[0][0].where).toEqual({ id: BRAND_ID, deletedAt: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expectNothingCreated();
  });

  it("faltan datos → 400 con mensaje en español", async () => {
    const res = await call(withFields({ appSecret: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Falta el App Secret");

    const short = await call({ ...BODY, name: "X" });
    expect((await short.json()).error).toContain("al menos 2 caracteres");

    const garbage = await call(null);
    expect(garbage.status).toBe(400);
    expect((await garbage.json()).error).toBe("Datos inválidos");
    expectNothingCreated();
  });

  it("si la transacción falla → 500, no se guarda ninguna y no se suscribe la Página", async () => {
    transaction.mockRejectedValue(Object.assign(new Error(`fallo con ${TOKEN}`), { code: "P2002" }));
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("no se guardó ninguna");
    expect(subscribeCalls()).toHaveLength(0);
    expect(auditCreate).not.toHaveBeenCalled();
    for (const spy of consoleSpies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
    }
  });
});

describe("POST /api/admin/connectors/meta-dms · suscripción de la Página", () => {
  it("suscribe la Página sin quitarle los campos que ya tenía", async () => {
    const res = await call();
    const [post] = subscribeCalls();
    expect(String(post[0])).toBe("https://graph.facebook.com/v24.0/PAGE-1/subscribed_apps");
    expect(new URLSearchParams(post[1].body).get("subscribed_fields")).toBe("leadgen,messages,message_echoes,feed");
    expect((await res.json()).data.subscription).toEqual({
      ok: true,
      changed: true,
      subscribedFields: ["leadgen", "messages", "message_echoes", "feed"],
      missing: [],
    });
  });

  it("si ya estaba suscrita, no escribe en Meta", async () => {
    graph.subGet = [{ status: 200, body: { data: [{ subscribed_fields: ["messages", "message_echoes", "feed"] }] } }];
    const res = await call();
    expect(subscribeCalls()).toHaveLength(0);
    expect((await res.json()).data.subscription).toMatchObject({ ok: true, changed: false });
  });

  it("si Meta no acepta la suscripción, las cuentas se quedan (201) y se informa el error", async () => {
    graph.subPost = { status: 400, body: { error: { code: 200, message: "Requires pages_manage_metadata" } } };
    const res = await call();
    expect(res.status).toBe(201);
    expect(transaction).toHaveBeenCalledTimes(1);
    const { data } = await res.json();
    expect(data.connectors).toHaveLength(2);
    expect(data.subscription.ok).toBe(false);
    expect(data.subscription.error).toContain("Meta no aceptó la suscripción");
    expect(data.subscription.error).toContain("pages_manage_metadata");
  });

  it("si no se puede leer la suscripción, tampoco tumba el alta", async () => {
    graph.subGet = [{ status: 500, body: { error: { code: 2, message: "Service temporarily unavailable" } } }];
    const res = await call();
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.subscription).toMatchObject({ ok: false });
    expect(data.subscription.error).toContain("No se pudo leer la Página");
    expect(subscribeCalls()).toHaveLength(0);
  });
});

describe("POST /api/admin/connectors/meta-dms · secretos", () => {
  it("ni el token ni el App Secret salen en la respuesta ni en un log", async () => {
    const res = await call();
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(APP_SECRET);
    expect(text).not.toContain(VERIFY);
    for (const spy of consoleSpies) {
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain(TOKEN);
      expect(logged).not.toContain(APP_SECRET);
    }
    // Ni en la bitácora.
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(APP_SECRET);
  });

  it("si Graph repite el token en el error de suscripción, se tapa", async () => {
    graph.subPost = { status: 400, body: { error: { code: 190, message: `Malformed access token ${TOKEN}` } } };
    const res = await call();
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("[token]");
  });

  it("los rechazos tampoco devuelven el token", async () => {
    graph.me = { status: 400, body: { error: { code: 190, message: `Malformed access token ${TOKEN}` } } };
    const text = JSON.stringify(await (await call()).json());
    expect(text).not.toContain(TOKEN);
  });
});

describe("POST /api/admin/connectors/meta-dms · roles", () => {
  it.each(["ASESOR", "BROKER", "ASESOR_SR", "TEAM_LEADER"])("%s → 403 sin tocar nada", async (role) => {
    session.user.role = role;
    const res = await call();
    expect(res.status).toBe(403);
    expect(connectorFindMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expectNothingCreated();
  });

  it.each(["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"])("%s → 201", async (role) => {
    session.user.role = role;
    expect((await call()).status).toBe(201);
  });
});

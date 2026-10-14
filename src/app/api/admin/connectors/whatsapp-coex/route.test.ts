// POST /api/admin/connectors/whatsapp-coex (2026-10-14): alta por Embedded Signup v4 de un
// número de marca en coexistencia. Lo que importa: el orden (canje primero; cuenta antes de pedir
// el historial), la idempotencia (mismo número = update, sin volver a pedir la sincronización),
// los roles, el mapeo de errores de Meta a respuestas legibles, y que ni el token, ni el código,
// ni el App Secret salgan en la respuesta o en un log. Se ejercita el orquestador real
// (lib/whatsapp/coex/onboard.ts) contra Graph y Prisma falsos.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const session: { user: { id: string; role: string } | null } = { user: { id: "u-admin", role: "ADMIN" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session.user ? session : null) }));

const connectorFindFirst = vi.fn();
const connectorCreate = vi.fn();
const connectorUpdate = vi.fn();
const brandFindFirst = vi.fn();
const auditCreate = vi.fn();
const executeRaw = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: {
      findFirst: (...a: unknown[]) => connectorFindFirst(...a),
      create: (...a: unknown[]) => connectorCreate(...a),
      update: (...a: unknown[]) => connectorUpdate(...a),
    },
    brand: { findFirst: (...a: unknown[]) => brandFindFirst(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
    $executeRaw: (...a: unknown[]) => executeRaw(...a),
  },
}));

// Cifrar de verdad necesita la llave de PII; aquí basta ver qué se cifraría.
const writeCreds = vi.fn();
const readCreds = vi.fn();
vi.mock("@/lib/intake/connectors", () => ({
  writeCredentials: (...a: unknown[]) => writeCreds(...a),
  readCredentials: (...a: unknown[]) => readCreds(...a),
}));

import { POST } from "./route";

const CODE = "AQBcodigoDeEmbeddedSignupMuySecreto123";
const TOKEN = "EAAGtokenDeNegocioDeYaxnah987654321";
const APP_SECRET = "app-secret-de-propyte-crm";
const APP_ID = "1234567890123";
const WABA = "102290129340398";
const PNID = "106540352242922";
const BRAND_ID = "3f2b8c1e-5d4a-4b6f-9c7e-1a2b3c4d5e6f";

type Reply = { status: number; body: unknown } | "network";
let graph: {
  token: Reply;
  phone: Reply;
  list: Reply;
  subscribe: Reply;
  syncContacts: Reply;
  syncHistory: Reply;
};
const fetchMock = vi.fn();
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

function route(url: string, init?: RequestInit): Reply {
  if (url.includes("/oauth/access_token")) return graph.token;
  if (url.includes("/subscribed_apps")) return graph.subscribe;
  if (url.includes("/phone_numbers")) return graph.list;
  if (url.includes("/smb_app_data")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { sync_type?: string };
    return body.sync_type === "history" ? graph.syncHistory : graph.syncContacts;
  }
  return graph.phone;
}

const BODY = { code: CODE, wabaId: WABA, phoneNumberId: PNID, brandId: BRAND_ID };
const req = (body: unknown) => ({ json: () => Promise.resolve(body) }) as never;
const call = (body: unknown = BODY) => POST(req(body));

/** Todo lo que se escribió en consola, para buscar secretos. */
function everythingLogged(): string {
  const spies = [console.log, console.info, console.warn, console.error] as unknown as Array<{ mock: { calls: unknown[][] } }>;
  return spies.flatMap((s) => s.mock.calls.flat()).map((x) => (x instanceof Error ? x.message : JSON.stringify(x))).join("\n");
}

beforeEach(() => {
  session.user = { id: "u-admin", role: "ADMIN" };
  process.env.NEXT_PUBLIC_META_APP_ID = APP_ID;
  process.env.META_WA_APP_SECRET = APP_SECRET;
  graph = {
    token: { status: 200, body: { access_token: TOKEN, token_type: "bearer" } },
    phone: {
      status: 200,
      body: { id: PNID, display_phone_number: "+52 999 123 4567", verified_name: "Yaxnáh", is_on_biz_app: true, platform_type: "CLOUD_API" },
    },
    list: { status: 200, body: { data: [{ id: PNID, display_phone_number: "+52 999 123 4567", verified_name: "Yaxnáh" }] } },
    subscribe: { status: 200, body: { success: true } },
    syncContacts: { status: 200, body: { messaging_product: "whatsapp", request_id: "req-contacts" } },
    syncHistory: { status: 200, body: { messaging_product: "whatsapp", request_id: "req-history" } },
  };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const r = route(String(url), init);
    if (r === "network") throw new TypeError("fetch failed");
    return { ok: r.status < 400, status: r.status, json: () => Promise.resolve(r.body) };
  });
  vi.stubGlobal("fetch", fetchMock);

  connectorFindFirst.mockReset();
  connectorFindFirst.mockResolvedValue(null);
  connectorCreate.mockReset();
  connectorCreate.mockImplementation(async (args: { data: { name: string; status: string } }) => ({
    id: "conn-1",
    name: args.data.name,
    status: args.data.status,
  }));
  connectorUpdate.mockReset();
  connectorUpdate.mockImplementation(async (args: { data: { status: string; name?: string } }) => ({
    id: "conn-old",
    name: args.data.name ?? "WhatsApp · Yaxnáh",
    status: args.data.status,
  }));
  brandFindFirst.mockReset();
  brandFindFirst.mockResolvedValue({ id: BRAND_ID });
  auditCreate.mockReset();
  auditCreate.mockResolvedValue({});
  executeRaw.mockReset();
  executeRaw.mockResolvedValue(1);
  writeCreds.mockReset();
  writeCreds.mockReturnValue("cifrado");
  readCreds.mockReset();
  readCreds.mockReturnValue(null);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_META_APP_ID;
  delete process.env.META_WA_APP_SECRET;
});

describe("alta de un número de marca en coexistencia — camino feliz", () => {
  it("canjea, suscribe, crea la cuenta ACTIVA de marca y pide contactos e historial (201)", async () => {
    const res = await call();
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.created).toBe(true);
    expect(json.data.connector).toEqual({ id: "conn-1", name: "WhatsApp · Yaxnáh", status: "ACTIVE" });
    expect(json.data.number).toMatchObject({ phoneNumberId: PNID, wabaId: WABA, displayPhone: "+52 999 123 4567" });
    expect(json.data.sync).toEqual({ contacts: { status: "requested" }, history: { status: "requested" } });

    // El canje va primero (el código vive 30 s) y con client_id/client_secret/code.
    const first = new URL(urls()[0]);
    expect(first.pathname).toMatch(/\/oauth\/access_token$/);
    expect(first.searchParams.get("client_id")).toBe(APP_ID);
    expect(first.searchParams.get("client_secret")).toBe(APP_SECRET);
    expect(first.searchParams.get("code")).toBe(CODE);

    // La suscripción y las sincronizaciones van con el token en la cabecera, nunca en la URL.
    const sub = fetchMock.mock.calls.find((c) => String(c[0]).endsWith(`/${WABA}/subscribed_apps`));
    expect(sub?.[1]).toMatchObject({ method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } });
    for (const u of urls().slice(1)) expect(u).not.toContain(TOKEN);

    // No se registra el número: la doc de coexistencia dice que ya está registrado.
    expect(urls().some((u) => u.includes("/register"))).toBe(false);

    const data = connectorCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      provider: "WHATSAPP",
      scope: "BRAND",
      status: "ACTIVE",
      brandId: BRAND_ID,
      credentials: "cifrado",
      config: { phoneNumberId: PNID, wabaId: WABA, onboarding: "coexistence", coex: { accountState: "CONNECTED", subscribed: true } },
    });
    expect(writeCreds).toHaveBeenCalledWith({ accessToken: TOKEN });
  });

  it("la cuenta existe ANTES de pedir el historial (sus webhooks llegan en segundos)", async () => {
    const order: string[] = [];
    connectorCreate.mockImplementation(async () => {
      order.push("create");
      return { id: "conn-1", name: "x", status: "ACTIVE" };
    });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/smb_app_data")) order.push(`sync:${JSON.parse(String(init?.body)).sync_type}`);
      const r = route(String(url), init);
      if (r === "network") throw new TypeError("fetch failed");
      return { ok: r.status < 400, status: r.status, json: () => Promise.resolve(r.body) };
    });
    await call();
    expect(order).toEqual(["create", "sync:smb_app_state_sync", "sync:history"]);
  });

  it("sin phone_number_id (el evento de coexistencia solo trae el WABA) busca el número en la WABA", async () => {
    const res = await call({ code: CODE, wabaId: WABA, brandId: null });
    expect(res.status).toBe(201);
    expect(urls().some((u) => u.includes(`/${WABA}/phone_numbers`))).toBe(true);
    expect(connectorCreate.mock.calls[0][0].data.config.phoneNumberId).toBe(PNID);
    expect(connectorCreate.mock.calls[0][0].data.brandId).toBeNull();
  });

  it("varios números en la WABA y ninguno distinguible → 409 sin escribir nada", async () => {
    graph.list = {
      status: 200,
      body: { data: [{ id: "111111", display_phone_number: "+52 1" }, { id: "222222", display_phone_number: "+52 2" }] },
    };
    graph.phone = { status: 200, body: { id: "111111", display_phone_number: "+52 1", is_on_biz_app: true } };
    const res = await call({ code: CODE, wabaId: WABA });
    expect(res.status).toBe(409);
    expect(connectorCreate).not.toHaveBeenCalled();
  });

  it("estado de la sincronización: REQUESTED antes de pedir y el request_id en su propia clave", async () => {
    await call();
    const patches = executeRaw.mock.calls.map((c) => JSON.parse(String(c[1])));
    expect(patches[0]).toEqual({ contactsSync: { state: "REQUESTED", at: expect.any(String) } });
    expect(patches).toContainEqual({ contactsSyncRequestId: "req-contacts" });
    expect(patches).toContainEqual({ historySync: { state: "REQUESTED", at: expect.any(String) } });
    expect(patches).toContainEqual({ historySyncRequestId: "req-history" });
  });
});

describe("idempotencia", () => {
  const existing = (coex: Record<string, unknown>, scope = "BRAND") => ({
    id: "conn-old",
    name: "WhatsApp · Yaxnáh",
    scope,
    status: "ACTIVE",
    brandId: BRAND_ID,
    credentials: "viejo",
    config: { phoneNumberId: PNID, wabaId: WABA, displayPhone: "+52 999 123 4567", coex },
  });

  it("mismo número otra vez → actualiza la cuenta (200), no crea otra", async () => {
    connectorFindFirst.mockResolvedValue(existing({ accountState: "CONNECTED", contactsSync: { state: "REQUESTED" }, historySync: { state: "COMPLETE", progress: 100 } }));
    readCreds.mockReturnValue({ accessToken: "viejo" });
    const res = await call();
    expect(res.status).toBe(200);
    expect(connectorCreate).not.toHaveBeenCalled();
    expect(connectorUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "conn-old" } }));
    expect(writeCreds).toHaveBeenCalledWith({ accessToken: TOKEN });
    // Ya se pidió en esta conexión: no se vuelve a pedir (Meta solo deja una vez).
    expect(urls().some((u) => u.includes("/smb_app_data"))).toBe(false);
    const json = await res.json();
    expect(json.data.sync.history).toEqual({ status: "skipped", reason: "ya se pidió en esta conexión" });
    // Y el estado de la sincronización no se resetea.
    expect(connectorUpdate.mock.calls[0][0].data.config.coex.historySync).toEqual({ state: "COMPLETE", progress: 100 });
  });

  it("si la sincronización anterior falló, se vuelve a pedir", async () => {
    connectorFindFirst.mockResolvedValue(existing({ accountState: "CONNECTED", contactsSync: { state: "REQUESTED" }, historySync: { state: "FAILED" } }));
    await call();
    const syncs = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/smb_app_data")).map((c) => JSON.parse(String(c[1]?.body)).sync_type);
    expect(syncs).toEqual(["history"]);
  });

  it("tras una desconexión (PARTNER_REMOVED) la conexión es nueva: se piden las dos otra vez", async () => {
    connectorFindFirst.mockResolvedValue(existing({ accountState: "DISCONNECTED", contactsSync: { state: "REQUESTED" }, historySync: { state: "COMPLETE" } }));
    await call();
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/smb_app_data"))).toHaveLength(2);
    expect(connectorUpdate.mock.calls[0][0].data.config.coex).not.toHaveProperty("historySync");
  });

  it("el mismo número ya conectado como número de ASESOR → 409 sin tocar nada", async () => {
    connectorFindFirst.mockResolvedValue(existing({ accountState: "CONNECTED" }, "ADVISOR"));
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/de un asesor/);
    expect(connectorUpdate).not.toHaveBeenCalled();
    expect(urls().some((u) => u.includes("/subscribed_apps"))).toBe(false);
  });

  it("carrera con otra alta del mismo número (índice único) → 409", async () => {
    connectorCreate.mockRejectedValue(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    const res = await call();
    expect(res.status).toBe(409);
  });
});

describe("roles", () => {
  for (const role of ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"]) {
    it(`${role} puede conectar un número de marca`, async () => {
      session.user = { id: "u1", role };
      expect((await call()).status).toBe(201);
    });
  }
  for (const role of ["ASESOR", "ASESOR_SR", "HOSTESS"]) {
    it(`${role} → 403 sin llamar a Meta`, async () => {
      session.user = { id: "u1", role };
      expect((await call()).status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
  it("sin sesión → 403", async () => {
    session.user = null;
    expect((await call()).status).toBe(403);
  });
});

describe("errores", () => {
  it("cuerpo inválido → 400 sin repetir el código recibido", async () => {
    const res = await call({ code: CODE, wabaId: "no-es-un-id" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain(CODE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marca inexistente → 400 antes de llamar a Meta", async () => {
    brandFindFirst.mockResolvedValue(null);
    expect((await call()).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin App ID o App Secret en el entorno → 503 que nombra la variable", async () => {
    delete process.env.META_WA_APP_SECRET;
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("META_WA_APP_SECRET");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("código caducado (Meta lo rechaza) → 400 legible y nada guardado", async () => {
    graph.token = { status: 400, body: { error: { code: 100, message: `This authorization code has expired: ${CODE}` } } };
    const res = await call();
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(/30 segundos/);
    expect(error).not.toContain(CODE);
    expect(connectorCreate).not.toHaveBeenCalled();
  });

  it("Meta no responde al canje → 502", async () => {
    graph.token = "network";
    expect((await call()).status).toBe(502);
  });

  it("no se puede leer el número → 400 y nada guardado", async () => {
    graph.phone = { status: 400, body: { error: { code: 100, message: "Unsupported get request" } } };
    expect((await call()).status).toBe(400);
    expect(connectorCreate).not.toHaveBeenCalled();
  });

  it("la suscripción a la WABA falla → la cuenta se guarda en ERROR y NO se piden sincronizaciones", async () => {
    graph.subscribe = { status: 400, body: { error: { code: 200, message: "Permissions error" } } };
    const res = await call();
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.subscription.ok).toBe(false);
    expect(json.data.sync.history.status).toBe("skipped");
    expect(connectorCreate.mock.calls[0][0].data).toMatchObject({ status: "ERROR", config: { coex: { subscribed: false } } });
    expect(urls().some((u) => u.includes("/smb_app_data"))).toBe(false);
  });

  it("Meta rechaza el historial → el alta sigue, el historial queda FAILED con el motivo", async () => {
    graph.syncHistory = { status: 400, body: { error: { code: 131000, message: "Sync window expired" } } };
    const res = await call();
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.sync.history).toEqual({ status: "failed", error: expect.stringContaining("Sync window expired") });
    const patches = executeRaw.mock.calls.map((c) => JSON.parse(String(c[1])));
    expect(patches).toContainEqual({ historySync: { state: "FAILED", at: expect.any(String), error: expect.stringContaining("131000") } });
  });
});

describe("secretos", () => {
  it("🚨 el token, el código y el App Secret no salen en la respuesta ni en ningún log", async () => {
    // Graph repite el token en un error de la suscripción: tampoco debe salir.
    graph.subscribe = { status: 400, body: { error: { code: 190, message: `Malformed access token ${TOKEN}` } } };
    graph.syncHistory = { status: 400, body: { error: { code: 1, message: `bad ${TOKEN}` } } };
    const res = await call();
    const text = JSON.stringify(await res.json());
    for (const secret of [TOKEN, CODE, APP_SECRET]) {
      expect(text).not.toContain(secret);
      expect(everythingLogged()).not.toContain(secret);
    }
    // Tampoco en lo que se guarda en claro (config) ni en la auditoría.
    expect(JSON.stringify(connectorCreate.mock.calls[0][0].data.config)).not.toContain(TOKEN);
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(TOKEN);
  });

  it("🚨 en el camino feliz la respuesta tampoco trae el token", async () => {
    const res = await call();
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
  });
});

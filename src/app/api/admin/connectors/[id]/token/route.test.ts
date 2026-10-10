// POST /api/admin/connectors/[id]/token (2026-10-10): cambiar solo el Page Access Token de una
// cuenta de IG/Messenger. Lo que importa: que appSecret y verifyToken sobrevivan, que no se
// escriba nada si el token es de otra Página o Meta lo rechaza, y que el token no salga nunca.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const session = { user: { id: "u1", role: "MARKETING" } };
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => Promise.resolve(session) }));

const connectorFindFirst = vi.fn();
const connectorFindMany = vi.fn();
const connectorUpdate = vi.fn();
const auditCreate = vi.fn();
const transaction = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: {
      findFirst: (...a: unknown[]) => connectorFindFirst(...a),
      findMany: (...a: unknown[]) => connectorFindMany(...a),
      update: (...a: unknown[]) => connectorUpdate(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));

// Cifrar de verdad necesita la llave de PII del entorno; aquí basta ver qué se cifraría.
const readCreds = vi.fn();
const writeCreds = vi.fn();
vi.mock("@/lib/intake/connectors", () => ({
  readCredentials: (...a: unknown[]) => readCreds(...a),
  writeCredentials: (...a: unknown[]) => writeCreds(...a),
}));

import { POST } from "./route";

const TOKEN = "EAAnuevoTokenDelUsuarioDelSistema123";
const props = { params: Promise.resolve({ id: "c1" }) };
const req = (body: unknown) => ({ json: () => Promise.resolve(body) }) as never;
const call = (body: unknown = { pageAccessToken: TOKEN }) => POST(req(body), props);

const IG = {
  id: "c1",
  name: "Instagram | Nativa Tulum",
  provider: "INSTAGRAM",
  config: { pageId: "PAGE-1", igBusinessId: "IG-1" },
  credentials: "v1:blob-cifrado",
};
const OLD_CREDS = { pageAccessToken: "EAAviejo", appSecret: "APP-SECRET", verifyToken: "VERIFY" };

function graphReplies(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValue({ ok, status, json: () => Promise.resolve(body) });
}

const fetchMock = vi.fn();
const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  for (const m of [connectorFindFirst, connectorFindMany, connectorUpdate, auditCreate, transaction, readCreds, writeCreds, fetchMock]) m.mockReset();
  session.user.role = "MARKETING";
  connectorFindFirst.mockResolvedValue(IG);
  connectorFindMany.mockResolvedValue([]);
  transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  connectorUpdate.mockResolvedValue({ id: "c1" });
  auditCreate.mockResolvedValue({});
  readCreds.mockReturnValue({ ...OLD_CREDS });
  writeCreds.mockReturnValue("v1:blob-nuevo");
  graphReplies({ id: "PAGE-1", name: "Nativa Tulum" });
  vi.stubGlobal("fetch", fetchMock);
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    consoleSpies.push(vi.spyOn(console, level).mockImplementation(() => {}));
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (consoleSpies.length) consoleSpies.pop()!.mockRestore();
});

describe("POST /api/admin/connectors/[id]/token", () => {
  it("token de la página correcta: conserva appSecret/verifyToken y limpia los fallos", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      pageId: "PAGE-1",
      pageName: "Nativa Tulum",
      updated: ["Instagram | Nativa Tulum"],
      skipped: [],
    });

    expect(writeCreds).toHaveBeenCalledWith({ pageAccessToken: TOKEN, appSecret: "APP-SECRET", verifyToken: "VERIFY" });
    expect(connectorUpdate).toHaveBeenCalledTimes(1);
    const { where, data } = connectorUpdate.mock.calls[0][0];
    expect(where).toEqual({ id: "c1" });
    expect(data).toEqual({ credentials: "v1:blob-nuevo", errorCount: 0, lastError: null });
  });

  it("pregunta a Meta con el token en la cabecera, nunca en la URL", async () => {
    await call();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v24.0/me?fields=id,name");
    expect(String(url)).not.toContain(TOKEN);
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("recorta espacios y saltos de línea del token pegado", async () => {
    await call({ pageAccessToken: `  ${TOKEN}\n` });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(writeCreds.mock.calls[0][0].pageAccessToken).toBe(TOKEN);
  });

  it("también sirve para cuentas de Messenger", async () => {
    connectorFindFirst.mockResolvedValue({ ...IG, provider: "MESSENGER", config: { pageId: "PAGE-1" } });
    expect((await call()).status).toBe(200);
    expect(connectorUpdate).toHaveBeenCalledTimes(1);
  });

  describe("un token por Página: también actualiza la otra cuenta de la misma Página", () => {
    const MESSENGER = {
      id: "c2",
      name: "Messenger | DM Nativa",
      provider: "MESSENGER",
      config: { pageId: "PAGE-1" },
      credentials: "v1:blob-messenger",
    };
    const OTRA_PAGINA = { ...MESSENGER, id: "c3", name: "Messenger | DM Yaxnah", config: { pageId: "PAGE-9" } };

    it("aplica el token a las dos cuentas, cada una con sus propias credenciales", async () => {
      connectorFindMany.mockResolvedValue([MESSENGER, OTRA_PAGINA]);
      readCreds.mockImplementation((c: { id: string }) =>
        c.id === "c2" ? { pageAccessToken: "EAAviejoM", appSecret: "SECRET-M", verifyToken: "VERIFY-M" } : { ...OLD_CREDS }
      );
      const res = await call();
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.updated).toEqual(["Instagram | Nativa Tulum", "Messenger | DM Nativa"]);
      expect(data.skipped).toEqual([]);

      expect(connectorUpdate).toHaveBeenCalledTimes(2);
      expect(connectorUpdate.mock.calls.map((c) => c[0].where.id)).toEqual(["c1", "c2"]);
      expect(writeCreds).toHaveBeenCalledWith({ pageAccessToken: TOKEN, appSecret: "SECRET-M", verifyToken: "VERIFY-M" });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(auditCreate).toHaveBeenCalledTimes(2);
    });

    it("busca solo cuentas sociales vivas distintas de la actual", async () => {
      await call();
      expect(connectorFindMany.mock.calls[0][0].where).toEqual({
        provider: { in: ["INSTAGRAM", "MESSENGER"] },
        deletedAt: null,
        id: { not: "c1" },
      });
    });

    it("compara el pageId aunque venga como número", async () => {
      connectorFindMany.mockResolvedValue([{ ...MESSENGER, config: { pageId: 12345 } }]);
      connectorFindFirst.mockResolvedValue({ ...IG, config: { pageId: "12345" } });
      graphReplies({ id: "12345", name: "Nativa Tulum" });
      const { data } = await (await call()).json();
      expect(data.updated).toContain("Messenger | DM Nativa");
    });

    it("la cuenta hermana con credenciales ilegibles se salta y se reporta", async () => {
      connectorFindMany.mockResolvedValue([MESSENGER]);
      readCreds.mockImplementation((c: { id: string }) => (c.id === "c2" ? null : { ...OLD_CREDS }));
      const { data } = await (await call()).json();
      expect(data.updated).toEqual(["Instagram | Nativa Tulum"]);
      expect(data.skipped).toEqual(["Messenger | DM Nativa"]);
      expect(connectorUpdate).toHaveBeenCalledTimes(1);
    });

    it("con token de otra Página no toca ninguna de las dos", async () => {
      connectorFindMany.mockResolvedValue([MESSENGER]);
      graphReplies({ id: "PAGE-2", name: "Yaxnáh" });
      expect((await call()).status).toBe(400);
      expect(connectorUpdate).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  it("token de otra página: 400 con las dos páginas y no escribe nada", async () => {
    graphReplies({ id: "PAGE-2", name: "Yaxnáh" });
    const res = await call();
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain("«Yaxnáh» (PAGE-2)");
    expect(error).toContain("(PAGE-1)");
    expect(writeCreds).not.toHaveBeenCalled();
    expect(connectorUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("Meta rechaza el token: 400 con su mensaje y no escribe nada", async () => {
    graphReplies({ error: { code: 190, message: "Invalid OAuth access token - Cannot parse access token" } }, false, 400);
    const res = await call();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Invalid OAuth access token");
    expect(writeCreds).not.toHaveBeenCalled();
    expect(connectorUpdate).not.toHaveBeenCalled();
  });

  it("Meta no responde: 502 y no escribe nada", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("ECONNRESET");
    expect(connectorUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["éxito", () => graphReplies({ id: "PAGE-1", name: "Nativa Tulum" })],
    ["otra página", () => graphReplies({ id: "PAGE-2", name: "Yaxnáh" })],
    // Graph a veces repite el token en el mensaje de error.
    ["Graph repite el token", () => graphReplies({ error: { code: 190, message: `Malformed access token ${TOKEN}` } }, false, 400)],
    ["red caída con el token en el mensaje", () => fetchMock.mockRejectedValue(new Error(`fallo ${TOKEN}`))],
  ])("el token no aparece en la respuesta, la auditoría ni la consola (%s)", async (_label, setup) => {
    setup();
    const text = JSON.stringify(await (await call()).json());
    expect(text).not.toContain(TOKEN);
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(TOKEN);
    for (const spy of consoleSpies) expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
  });

  it("cuenta inexistente, borrada o que no es social: 404 sin llamar a Meta", async () => {
    connectorFindFirst.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(connectorFindFirst.mock.calls[0][0].where).toEqual({
      id: "c1",
      provider: { in: ["INSTAGRAM", "MESSENGER"] },
      deletedAt: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(connectorUpdate).not.toHaveBeenCalled();
  });

  it("cuenta sin pageId: 400 sin llamar a Meta", async () => {
    connectorFindFirst.mockResolvedValue({ ...IG, config: {} });
    expect((await call()).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("credenciales que no se pueden descifrar: no escribe (perdería appSecret y verifyToken)", async () => {
    readCreds.mockReturnValue(null);
    const res = await call();
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(connectorUpdate).not.toHaveBeenCalled();
  });

  it("cuenta sin credenciales previas: guarda solo el token", async () => {
    connectorFindFirst.mockResolvedValue({ ...IG, credentials: null });
    readCreds.mockReturnValue(null);
    expect((await call()).status).toBe(200);
    expect(writeCreds).toHaveBeenCalledWith({ pageAccessToken: TOKEN });
  });

  it("un rol de venta sigue fuera", async () => {
    session.user.role = "ASESOR";
    expect((await call()).status).toBe(403);
    expect(connectorFindFirst).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("MARKETING puede cambiar el token de sus cuentas", async () => {
    session.user.role = "MARKETING";
    expect((await call()).status).toBe(200);
  });

  it.each([
    ["vacío", { pageAccessToken: "" }],
    ["solo espacios", { pageAccessToken: "   " }],
    ["sin campo", {}],
    ["con espacios dentro", { pageAccessToken: "EAA abc" }],
    ["demasiado largo", { pageAccessToken: "E".repeat(2049) }],
  ])("token %s: 400 sin tocar la base ni Meta", async (_label, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
    expect(connectorFindFirst).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

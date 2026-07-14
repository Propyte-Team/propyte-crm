import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const setChangeSource = vi.fn();
vi.mock("@/lib/audit/change-context", () => ({
  setChangeSource: (...a: unknown[]) => setChangeSource(...a),
}));

import { classifyContactType, maybeClassifyContact, MAX_CLASSIFY_ATTEMPTS } from "./classify";

function okClassify(type: string) {
  return {
    ok: true,
    json: async () => ({ content: [{ type: "text", text: JSON.stringify({ contactType: type }) }] }),
  };
}

const msgs = [{ role: "user" as const, content: "hola, soy broker y traigo un cliente" }];

beforeEach(() => {
  setChangeSource.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("classifyContactType", () => {
  it("clasificación válida → ContactType; manda schema con enum + UNKNOWN", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okClassify("BROKER_EXTERNO"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await classifyContactType({ messages: msgs, model: "claude-sonnet-5" })).toBe("BROKER_EXTERNO");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.output_config.format.schema.properties.contactType.enum).toContain("UNKNOWN");
    expect(body.output_config.format.schema.properties.contactType.enum).toContain("EMPLEO");
  });

  it("UNKNOWN, valor fuera del enum, HTTP !ok, sin API key o timeout → null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okClassify("UNKNOWN")));
    expect(await classifyContactType({ messages: msgs, model: "m" })).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okClassify("HACKER")));
    expect(await classifyContactType({ messages: msgs, model: "m" })).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await classifyContactType({ messages: msgs, model: "m" })).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("abort")));
    expect(await classifyContactType({ messages: msgs, model: "m" })).toBeNull();

    vi.unstubAllEnvs();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await classifyContactType({ messages: msgs, model: "m" })).toBeNull();
  });
});

function mkDb() {
  const contactUpdate = vi.fn().mockResolvedValue({});
  const auditCreate = vi.fn().mockResolvedValue({});
  const userFindFirst = vi.fn().mockResolvedValue({ id: "admin-1" });
  const db = {
    contact: { update: contactUpdate },
    auditLog: { create: auditCreate },
    user: { findFirst: userFindFirst },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ contact: { update: contactUpdate }, auditLog: { create: auditCreate } }),
  };
  return { db, contactUpdate, auditCreate, userFindFirst };
}

const baseContact = { id: "c1", contactType: "COMPRADOR" as const, assignedToId: "u1", custom: null };

describe("maybeClassifyContact", () => {
  it("detecta segmento distinto → actualiza contactType auditado (GUC + AuditLog) y guarda marker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okClassify("EMPLEO")));
    const { db, contactUpdate, auditCreate } = mkDb();
    const r = await maybeClassifyContact(db as never, baseContact, msgs, "m");
    expect(r).toBe("EMPLEO");
    expect(setChangeSource).toHaveBeenCalledWith(expect.anything(), { source: "bot_classifier", actorId: "u1" });
    expect(contactUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contactType: "EMPLEO",
        custom: expect.objectContaining({ bot_classification: expect.objectContaining({ type: "EMPLEO", attempts: 1 }) }),
      }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ changes: expect.objectContaining({ to: "EMPLEO", source: "bot_classifier" }) }),
    }));
  });

  it("NUNCA pisa un contactType puesto por humano (no default)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db, contactUpdate } = mkDb();
    const r = await maybeClassifyContact(db as never, { ...baseContact, contactType: "BROKER_EXTERNO" }, msgs, "m");
    expect(r).toBe("BROKER_EXTERNO");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("sin señal (UNKNOWN) → solo persiste el intento; respeta tope de intentos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okClassify("UNKNOWN")));
    const { db, contactUpdate, auditCreate } = mkDb();
    const r = await maybeClassifyContact(db as never, baseContact, msgs, "m");
    expect(r).toBe("COMPRADOR");
    expect(contactUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { custom: expect.objectContaining({ bot_classification: expect.objectContaining({ attempts: 1, type: null }) }) },
    }));
    expect(auditCreate).not.toHaveBeenCalled();

    // intentos agotados → ni llama a la API
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const spent = { ...baseContact, custom: { bot_classification: { attempts: MAX_CLASSIFY_ATTEMPTS, type: null } } };
    await maybeClassifyContact(db as never, spent, msgs, "m");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ya clasificado (marker.type) → no vuelve a llamar", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db } = mkDb();
    const done = { ...baseContact, custom: { bot_classification: { type: "EMPLEO", attempts: 1 } } };
    await maybeClassifyContact(db as never, done, msgs, "m");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cualquier error → devuelve el tipo actual (nunca rompe al bot)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okClassify("EMPLEO")));
    const { db, contactUpdate } = mkDb();
    contactUpdate.mockRejectedValue(new Error("db down"));
    const r = await maybeClassifyContact(db as never, baseContact, msgs, "m");
    expect(r).toBe("COMPRADOR");
  });
});

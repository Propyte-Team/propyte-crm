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

  it("#907: ya no ofrece REFERIDOR — quien refiere a alguien se clasifica como broker", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okClassify("BROKER_EXTERNO"));
    vi.stubGlobal("fetch", fetchMock);
    await classifyContactType({ messages: msgs, model: "m" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.output_config.format.schema.properties.contactType.enum).not.toContain("REFERIDOR");
    expect(body.system).not.toContain("REFERIDOR");
    expect(body.system).toMatch(/BROKER_EXTERNO:[^\n]*referir/);

    // Y si el modelo respondiera REFERIDOR de todos modos, no se escribe.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okClassify("REFERIDOR")));
    expect(await classifyContactType({ messages: msgs, model: "m" })).toBeNull();
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
  // Usuarios falsos (helper de actor, 2026-10-12): el que se pide por id existe y es
  // persona; el ADMIN de respaldo es admin-1.
  const userFindFirst = vi.fn(async ({ where }: { where: { id?: string } }): Promise<{ id: string } | null> =>
    where.id ? { id: where.id } : { id: "admin-1" },
  );
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

  // 2026-10-12: el cambio de segmento salía en la cronología firmado por la cuenta técnica
  // a la que estaba asignado el contacto (agentes@propyte.local). Ahora firma el helper común.
  it("asesor que es cuenta técnica: firma el ADMIN persona más antiguo y el contacto NO cambia de dueño", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okClassify("EMPLEO")));
    const { db, contactUpdate, auditCreate, userFindFirst } = mkDb();
    // agentes@propyte.local no pasa el filtro de persona: la consulta por id no lo trae.
    userFindFirst.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? null : { id: "admin-1" },
    );
    const r = await maybeClassifyContact(db as never, { ...baseContact, assignedToId: "u-agentes" }, msgs, "m");
    expect(r).toBe("EMPLEO");
    expect(setChangeSource).toHaveBeenCalledWith(expect.anything(), { source: "bot_classifier", actorId: "admin-1" });
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "admin-1" }) }));
    expect(contactUpdate.mock.calls[0][0].data).not.toHaveProperty("assignedToId");
  });

  it("sin ninguna persona (solo cuentas técnicas): clasifica igual, firmado como antes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okClassify("EMPLEO")));
    const { db, auditCreate, userFindFirst } = mkDb();
    userFindFirst.mockImplementation(async () => null);
    const r = await maybeClassifyContact(db as never, { ...baseContact, assignedToId: "u-agentes" }, msgs, "m");
    expect(r).toBe("EMPLEO");
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "u-agentes" }) }));
  });

  it("sin nadie a quien atribuirlo: guarda el marker pero no cambia el segmento (igual que antes)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okClassify("EMPLEO")));
    const { db, contactUpdate, auditCreate, userFindFirst } = mkDb();
    userFindFirst.mockImplementation(async () => null);
    const r = await maybeClassifyContact(db as never, { ...baseContact, assignedToId: null }, msgs, "m");
    expect(r).toBe("COMPRADOR");
    expect(auditCreate).not.toHaveBeenCalled();
    expect(contactUpdate.mock.calls[0][0].data).not.toHaveProperty("contactType");
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

  it("ya clasificado y algo más cambió el contactType después (marker.type != contactType) → se respeta, no reclasifica", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db } = mkDb();
    const done = { ...baseContact, custom: { bot_classification: { type: "EMPLEO", attempts: 1 } } };
    await maybeClassifyContact(db as never, done, msgs, "m");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // FIX 2026-09-21 (hallazgo de Luis): antes, en cuanto `marker.type` quedaba puesto la
  // clasificación se congelaba PARA SIEMPRE — un contacto clasificado como EMPLEO que
  // luego decía "mejor, estoy interesada en invertir" se quedaba archivado como EMPLEO
  // y el bot seguía respondiendo con la identidad de reclutamiento. Estas pruebas
  // habrían fallado contra el código viejo.
  it("cambio de intención tras una clasificación previa del propio bot → SÍ reclasifica (ya no se congela)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okClassify("INVERSIONISTA")));
    const { db, contactUpdate, auditCreate } = mkDb();
    const yaEmpleo = {
      ...baseContact,
      contactType: "EMPLEO" as const,
      custom: { bot_classification: { type: "EMPLEO", attempts: 0 } },
    };
    const r = await maybeClassifyContact(db as never, yaEmpleo, msgs, "m");
    expect(r).toBe("INVERSIONISTA");
    expect(contactUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contactType: "INVERSIONISTA",
        custom: expect.objectContaining({ bot_classification: expect.objectContaining({ type: "INVERSIONISTA" }) }),
      }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ changes: expect.objectContaining({ from: "EMPLEO", to: "INVERSIONISTA" }) }),
    }));
  });

  it("reconfirma el mismo tipo ya clasificado por el bot → no escribe nada (evita ruido en cada mensaje)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okClassify("EMPLEO")));
    const { db, contactUpdate } = mkDb();
    const yaEmpleo = {
      ...baseContact,
      contactType: "EMPLEO" as const,
      custom: { bot_classification: { type: "EMPLEO", attempts: 0 } },
    };
    const r = await maybeClassifyContact(db as never, yaEmpleo, msgs, "m");
    expect(r).toBe("EMPLEO");
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("cualquier error → devuelve el tipo actual (nunca rompe al bot)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okClassify("EMPLEO")));
    const { db, contactUpdate } = mkDb();
    contactUpdate.mockRejectedValue(new Error("db down"));
    const r = await maybeClassifyContact(db as never, baseContact, msgs, "m");
    expect(r).toBe("COMPRADOR");
  });
});

// #863: los contactos nuevos nacen SIN tipo (null) en vez de COMPRADOR.
describe("maybeClassifyContact — contacto sin tipo (#863)", () => {
  const sinTipo = { ...baseContact, contactType: null };

  it("intención explícita → le pone el tipo detectado (auditado)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okClassify("BROKER_EXTERNO")));
    const { db, contactUpdate, auditCreate } = mkDb();
    const r = await maybeClassifyContact(db as never, sinTipo, msgs, "m");
    expect(r).toBe("BROKER_EXTERNO");
    expect(contactUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contactType: "BROKER_EXTERNO" }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ changes: expect.objectContaining({ from: null, to: "BROKER_EXTERNO" }) }),
    }));
  });

  it("sin intención explícita (UNKNOWN) → se queda sin tipo: NO lo vuelve COMPRADOR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okClassify("UNKNOWN")));
    const { db, contactUpdate, auditCreate } = mkDb();
    const r = await maybeClassifyContact(db as never, sinTipo, msgs, "m");
    expect(r).toBeNull();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(contactUpdate.mock.calls[0][0].data).not.toHaveProperty("contactType");
  });

  it("un asesor lo regresó a «—» después de que el bot lo clasificara → se respeta", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db, contactUpdate } = mkDb();
    const vaciado = { ...sinTipo, custom: { bot_classification: { type: "INVERSIONISTA", attempts: 1 } } };
    const r = await maybeClassifyContact(db as never, vaciado, msgs, "m");
    expect(r).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
  });
});

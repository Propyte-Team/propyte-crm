import { describe, it, expect, vi, beforeEach } from "vitest";

// #939: «Registrar» desde la ficha del broker.

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const nonEditableKeys = vi.fn();
vi.mock("@/lib/metadata/core-fields", () => ({
  resolveCoreFieldAccess: async () => ({}),
  nonEditableKeys: (...a: unknown[]) => nonEditableKeys(...a),
}));

const brokerElegible = vi.fn();
vi.mock("@/lib/contacts/catalogo-brokers", () => ({
  brokerElegible: (...a: unknown[]) => brokerElegible(...a),
}));

const getContactAccessInfo = vi.fn();
vi.mock("@/server/contacts", () => ({
  getContactAccessInfo: (...a: unknown[]) => getContactAccessInfo(...a),
}));

const contactFindFirst = vi.fn();
const contactUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: { contact: { findFirst: (...a: unknown[]) => contactFindFirst(...a) } },
}));
const withChangeSource = vi.fn();
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (...a: unknown[]) => withChangeSource(...a),
}));

import { POST } from "./route";

const BROKER = "b-1";
const CONTACTO = "c-1";
const ASESOR = { user: { id: "a1", role: "ASESOR_JR", plaza: "MERIDA" } };

function llamar(body: unknown, brokerId = BROKER) {
  const req = new Request(`https://x/api/contacts/${brokerId}/registros`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
  return POST(req, { params: Promise.resolve({ id: brokerId }) });
}

function contacto(referredById: string | null, nombreBrokerActual = "Javi Mendez") {
  return {
    id: CONTACTO,
    firstName: "Ana",
    lastName: "López",
    referredById,
    referredBy: referredById ? { id: referredById, firstName: nombreBrokerActual, lastName: "" } : null,
  };
}

beforeEach(() => {
  [getServerSession, nonEditableKeys, brokerElegible, getContactAccessInfo, contactFindFirst, contactUpdate, withChangeSource].forEach(
    (m) => m.mockReset(),
  );
  getServerSession.mockResolvedValue(ASESOR);
  nonEditableKeys.mockReturnValue(new Set());
  brokerElegible.mockResolvedValue({ id: BROKER, contactType: "BROKER_EXTERNO" });
  getContactAccessInfo.mockResolvedValue({ ok: true, contact: { id: CONTACTO } });
  contactFindFirst.mockResolvedValue(contacto(null));
  contactUpdate.mockResolvedValue({ id: CONTACTO });
  withChangeSource.mockImplementation((_o: unknown, fn: (tx: unknown) => unknown) =>
    fn({ contact: { update: (...a: unknown[]) => contactUpdate(...a) } }),
  );
});

describe("POST /api/contacts/[id]/registros (#939)", () => {
  it("sin sesión: 401", async () => {
    getServerSession.mockResolvedValue(null);
    expect((await llamar({ contactId: CONTACTO })).status).toBe(401);
  });

  it("liga el contacto al broker, con la fuente «Registro de Broker» y en la cronología como «ui»", async () => {
    const res = await llamar({ contactId: CONTACTO });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: CONTACTO, nombre: "Ana López" }, yaEstaba: false });
    expect(contactUpdate).toHaveBeenCalledWith({
      where: { id: CONTACTO },
      data: { referredBy: { connect: { id: BROKER } }, leadSource: "REGISTRO_BROKER" },
    });
    expect(withChangeSource.mock.calls[0][0]).toEqual({ source: "ui", actorId: "a1" });
    // La puerta del contacto es la de su ficha, con la sesión de quien registra.
    expect(getContactAccessInfo).toHaveBeenCalledWith(CONTACTO, ASESOR);
  });

  it("si ya estaba con este broker: 200 yaEstaba, sin escribir", async () => {
    contactFindFirst.mockResolvedValue(contacto(BROKER));
    const body = await (await llamar({ contactId: CONTACTO })).json();
    expect(body.yaEstaba).toBe(true);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("si tenía OTRO broker: 409 con su nombre y no lo cambia", async () => {
    contactFindFirst.mockResolvedValue(contacto("b-otro"));
    const res = await llamar({ contactId: CONTACTO });
    expect(res.status).toBe(409);
    expect((await res.json()).brokerActual).toBe("Javi Mendez");
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("con reemplazar: true sí lo cambia", async () => {
    contactFindFirst.mockResolvedValue(contacto("b-otro"));
    const res = await llamar({ contactId: CONTACTO, reemplazar: true });
    expect(res.status).toBe(200);
    expect(contactUpdate).toHaveBeenCalledTimes(1);
  });

  it("contacto fuera del alcance de quien registra: 403 sin escribir", async () => {
    getContactAccessInfo.mockResolvedValue({ ok: false, reason: "forbidden" });
    const res = await llamar({ contactId: CONTACTO });
    expect(res.status).toBe(403);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("contacto inexistente (o de una marca que no ve): 404", async () => {
    getContactAccessInfo.mockResolvedValue({ ok: false, reason: "not_found" });
    expect((await llamar({ contactId: CONTACTO })).status).toBe(404);
  });

  it("broker no elegible (no existe, borrado u otra marca): 404 «no existe»", async () => {
    brokerElegible.mockResolvedValue(null);
    const res = await llamar({ contactId: CONTACTO });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("El broker elegido no existe");
    expect(getContactAccessInfo).not.toHaveBeenCalled();
  });

  it("el «broker» no es de tipo Broker: 400", async () => {
    brokerElegible.mockResolvedValue({ id: BROKER, contactType: "LEAD_COMPRADOR" });
    expect((await llamar({ contactId: CONTACTO })).status).toBe(400);
  });

  it("un broker no se puede registrar a sí mismo: 400", async () => {
    const res = await llamar({ contactId: BROKER });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Un contacto no puede ser registrado por sí mismo");
  });

  it("rol sin «Registrado por» editable: 403", async () => {
    nonEditableKeys.mockReturnValue(new Set(["referredById"]));
    expect((await llamar({ contactId: CONTACTO })).status).toBe(403);
    expect(brokerElegible).not.toHaveBeenCalled();
  });

  it("rol que no trabaja contactos (MARKETING): 403", async () => {
    getServerSession.mockResolvedValue({ user: { id: "m1", role: "MARKETING", plaza: "MERIDA" } });
    expect((await llamar({ contactId: CONTACTO })).status).toBe(403);
  });

  it("body inválido: 400", async () => {
    expect((await llamar("no-json")).status).toBe(400);
    expect((await llamar({})).status).toBe(400);
    expect((await llamar({ contactId: CONTACTO, otra: 1 })).status).toBe(400);
  });
});

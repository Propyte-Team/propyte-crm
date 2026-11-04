import { describe, it, expect, vi, beforeEach } from "vitest";

// #953 — /api/contacts PUT guarda el estado del flujograma v0.2 solo si el cambio está permitido
// desde el estado actual y trae lo que pide (razón, detalle, fecha, ticket). Antes de este cambio la
// API no conocía el campo: zod lo descartaba en silencio y respondía 200 sin guardar nada.

const contactFindFirst = vi.fn();
const contactUpdate = vi.fn();
const contactFindMany = vi.fn();
const contactCount = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findFirst: (...a: unknown[]) => contactFindFirst(...a),
      findMany: (...a: unknown[]) => contactFindMany(...a),
      count: (...a: unknown[]) => contactCount(...a),
    },
    user: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

const nonEditableKeys = vi.fn();
vi.mock("@/lib/metadata/core-fields", () => ({
  resolveCoreFieldAccess: async () => ({}),
  nonEditableKeys: (...a: unknown[]) => nonEditableKeys(...a),
}));

const fuentes: unknown[] = [];
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (opts: unknown, fn: (tx: unknown) => unknown) => {
    fuentes.push(opts);
    return fn({ contact: { update: (...a: unknown[]) => contactUpdate(...a) } });
  },
}));

vi.mock("@/server/contacts", () => ({
  getContactAccessInfo: vi.fn(async () => ({ ok: true, contact: {} })),
}));
vi.mock("@/lib/api/orden", () => ({ ordenValidado: () => ({ orderBy: undefined, error: null }) }));
vi.mock("@/lib/brands/user-access", () => ({ getVisibleBrands: () => Promise.resolve("ALL") }));

import { GET, PUT } from "./route";
import { cumple, type Fila } from "@/lib/testing/cumple-where";

const ASESOR = { user: { id: "u1", role: "ASESOR", plaza: "CANCUN" } };
const ADMIN = { user: { id: "a1", role: "ADMIN", plaza: "CANCUN" } };
const CONTACTO = "11111111-1111-4111-8111-111111111111";

function put(body: unknown) {
  return PUT(
    new Request(`https://x/api/contacts?id=${CONTACTO}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as unknown as import("next/server").NextRequest,
  );
}

let actual: Record<string, unknown>;
function contactoEn(estado: string | null, extra: Record<string, unknown> = {}) {
  actual = {
    id: CONTACTO,
    phone: "+5219991112233",
    whatsappUserId: null,
    estado,
    subestado: null,
    flujo: null,
    ticketEstimado: null,
    razonSalida: null,
    razonSalidaDetalle: null,
    fechaRecontacto: null,
    ...extra,
  };
}

beforeEach(() => {
  [contactFindFirst, contactUpdate, getServerSession, nonEditableKeys, contactFindMany, contactCount].forEach((m) => m.mockReset());
  fuentes.length = 0;
  getServerSession.mockResolvedValue(ASESOR);
  nonEditableKeys.mockReturnValue(new Set());
  contactUpdate.mockResolvedValue({ id: CONTACTO });
  contactFindMany.mockResolvedValue([]);
  contactCount.mockResolvedValue(0);
  contactoEn("NUEVO");
  contactFindFirst.mockImplementation(async (args: { where: { id?: string } }) => (args.where.id === CONTACTO ? actual : null));
});

const escrito = () => contactUpdate.mock.calls[0][0].data as Record<string, unknown>;

describe("PUT /api/contacts — estado (#953)", () => {
  it("Nuevo → Contactado: guarda el estado y pone el primer subestado", async () => {
    const res = await put({ estado: "CONTACTADO" });
    expect(res.status).toBe(200);
    expect(escrito()).toMatchObject({ estado: "CONTACTADO", subestado: "EN_CONVERSACION", razonSalida: null });
    expect(fuentes[0]).toEqual({ source: "ui", actorId: "u1" });
  });

  it("un salto que el flujograma no permite (Nuevo → Propuesta) se rechaza con 400 y no escribe", async () => {
    const res = await put({ estado: "PROPUESTA", ticketEstimado: 3_000_000 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/De Nuevo no se puede pasar a Propuesta/);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("regresar de Reunión a Sin respuesta se rechaza (pasó en producción por la ficha vieja)", async () => {
    contactoEn("REUNION", { subestado: "AGENDADA" });
    const res = await put({ estado: "SIN_RESPUESTA" });
    expect(res.status).toBe(400);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("entrar a una salida sin razón se rechaza", async () => {
    contactoEn("CONTACTADO", { subestado: "EN_CONVERSACION" });
    const res = await put({ estado: "CONTACTADO_PERDIDO" });
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toEqual(["razonSalida"]);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("entrar a una salida con su razón guarda razón y detalle, sin subestado", async () => {
    contactoEn("CONTACTADO", { subestado: "EN_CONVERSACION" });
    const res = await put({ estado: "CONTACTADO_PERDIDO", razonSalida: "NO_CALIFICA", razonSalidaDetalle: " Busca renta " });
    expect(res.status).toBe(200);
    expect(escrito()).toMatchObject({
      estado: "CONTACTADO_PERDIDO",
      subestado: null,
      razonSalida: "NO_CALIFICA",
      razonSalidaDetalle: "Busca renta",
      fechaRecontacto: null,
    });
  });

  it("una razón de otra salida se rechaza (Precio no es de Contactado perdido)", async () => {
    contactoEn("CONTACTADO");
    const res = await put({ estado: "CONTACTADO_PERDIDO", razonSalida: "PRECIO" });
    expect(res.status).toBe(400);
  });

  it("«Pospuso la compra» pide la fecha de recontacto", async () => {
    contactoEn("DEMO", { ticketEstimado: "3000000" });
    expect((await put({ estado: "NEGOCIO_PERDIDO", razonSalida: "POSPUSO" })).status).toBe(400);
    const res = await put({ estado: "NEGOCIO_PERDIDO", razonSalida: "POSPUSO", fechaRecontacto: "2099-01-15" });
    expect(res.status).toBe(200);
    expect(escrito().fechaRecontacto).toEqual(new Date("2099-01-15T00:00:00.000Z"));
  });

  it("desde Demo pide el ticket estimado; con el ticket en el mismo cambio, pasa", async () => {
    contactoEn("REUNION", { subestado: "CONFIRMADA" });
    const sinTicket = await put({ estado: "DEMO" });
    expect(sinTicket.status).toBe(400);
    expect((await sinTicket.json()).fields).toEqual(["ticketEstimado"]);
    const res = await put({ estado: "DEMO", ticketEstimado: 2_500_000, ticketMoneda: "USD" });
    expect(res.status).toBe(200);
    expect(escrito()).toMatchObject({ estado: "DEMO", subestado: "REALIZADA", ticketEstimado: 2_500_000, ticketMoneda: "USD" });
  });

  it("no se puede borrar el ticket de un contacto en Demo o después", async () => {
    contactoEn("PROPUESTA", { ticketEstimado: "1000000" });
    const res = await put({ ticketEstimado: null });
    expect(res.status).toBe(400);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("cambiar solo el subestado valida que sea del estado actual", async () => {
    contactoEn("REUNION", { subestado: "AGENDADA" });
    expect((await put({ subestado: "COTIZANDO" })).status).toBe(400);
    const res = await put({ subestado: "NO_SHOW" });
    expect(res.status).toBe(200);
    expect(escrito()).toEqual(expect.objectContaining({ subestado: "NO_SHOW" }));
    expect(escrito()).not.toHaveProperty("estado");
  });

  it("el estado respeta el flujo: F3 Captación MB no tiene Recorrido", async () => {
    contactoEn("REUNION", { flujo: "F3_CAPTACION_MB" });
    expect((await put({ estado: "RECORRIDO" })).status).toBe(400);
    expect((await put({ estado: "DEMO", ticketEstimado: 1 })).status).toBe(200);
  });

  it("#957: Apartado y Firma no se eligen a mano (los marca la operación)", async () => {
    contactoEn("PROPUESTA", { ticketEstimado: "1" });
    for (const estado of ["APARTADO", "FIRMA"]) {
      const res = await put({ estado });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/operación/);
    }
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("reactivación: de Negocio Perdido a Contactado se permite", async () => {
    contactoEn("NEGOCIO_PERDIDO", { razonSalida: "PRECIO" });
    const res = await put({ estado: "CONTACTADO" });
    expect(res.status).toBe(200);
    expect(escrito()).toMatchObject({ estado: "CONTACTADO", razonSalida: null, razonSalidaDetalle: null });
  });

  it("«Por clasificar» puede pasar a cualquier estado (con lo que pida)", async () => {
    contactoEn(null);
    const res = await put({ estado: "DEMO", ticketEstimado: 900_000 });
    expect(res.status).toBe(200);
    expect(escrito().estado).toBe("DEMO");
  });

  it("la corrección fuera del flujograma es solo de administradores y queda marcada", async () => {
    expect((await put({ estado: "PROPUESTA", ticketEstimado: 1, forzarCambio: true })).status).toBe(403);
    expect(contactUpdate).not.toHaveBeenCalled();
    getServerSession.mockResolvedValue(ADMIN);
    const res = await put({ estado: "PROPUESTA", ticketEstimado: 1, forzarCambio: true });
    expect(res.status).toBe(200);
    expect(escrito().estado).toBe("PROPUESTA");
    expect(fuentes.at(-1)).toEqual({ source: "ui_correccion_estado", actorId: "a1" });
  });

  it("si el rol no puede editar el estado, tampoco el subestado ni la razón (403)", async () => {
    nonEditableKeys.mockReturnValue(new Set(["estado"]));
    contactoEn("REUNION");
    expect((await put({ subestado: "CONFIRMADA" })).status).toBe(403);
    expect((await put({ razonSalida: "SPAM" })).status).toBe(403);
    expect(contactUpdate).not.toHaveBeenCalled();
  });

  it("editar otro campo no toca el estado", async () => {
    const res = await put({ nationality: "Mexicana" });
    expect(res.status).toBe(200);
    expect(escrito()).not.toHaveProperty("estado");
    expect(escrito()).not.toHaveProperty("subestado");
  });
});

describe("GET /api/contacts?status= — filtro por estado (#953)", () => {
  const FILAS: Fila[] = [
    { id: "nuevo", deletedAt: null, assignedToId: "u1", estado: "NUEVO", contactStatus: "NUEVO" },
    { id: "demo", deletedAt: null, assignedToId: "u1", estado: "DEMO", contactStatus: "PROSPECTO" },
    { id: "por-clasificar", deletedAt: null, assignedToId: "u1", estado: null, contactStatus: "PROSPECTO" },
  ];
  async function visibles(qs: string): Promise<string[]> {
    getServerSession.mockResolvedValue({ user: { id: "d1", role: "DIRECTOR", plaza: "CANCUN" } });
    const res = await GET(new Request(`https://x/api/contacts${qs}`) as never);
    expect(res.status).toBe(200);
    const where = contactFindMany.mock.calls.at(-1)![0].where as Fila;
    return FILAS.filter((f) => cumple(f, where)).map((f) => f.id as string);
  }

  it("un estado nuevo filtra por el estado", async () => {
    expect(await visibles("?status=DEMO")).toEqual(["demo"]);
  });
  it("«Por clasificar» lista los que no tienen estado", async () => {
    expect(await visibles("?status=SIN_ESTADO")).toEqual(["por-clasificar"]);
  });
  it("una vista guardada con el estado viejo (Prospecto) sigue funcionando", async () => {
    expect(await visibles("?status=PROSPECTO")).toEqual(["demo", "por-clasificar"]);
  });
});

describe("GET /api/contacts?etiqueta= — filtro por etiqueta (#958)", () => {
  const FILAS: Fila[] = [
    { id: "sin-razon", deletedAt: null, assignedToId: "u1", estado: "NEGOCIO_PERDIDO", tags: ["migracion-958", "falta-razon"] },
    { id: "broker", deletedAt: null, assignedToId: "u1", estado: "CONTACTADO", tags: ["confirmar-broker"] },
    { id: "sin-etiquetas", deletedAt: null, assignedToId: "u1", estado: "NUEVO", tags: [] },
  ];
  async function visibles(qs: string): Promise<string[]> {
    getServerSession.mockResolvedValue({ user: { id: "d1", role: "DIRECTOR", plaza: "CANCUN" } });
    const res = await GET(new Request(`https://x/api/contacts${qs}`) as never);
    expect(res.status).toBe(200);
    const where = contactFindMany.mock.calls.at(-1)![0].where as Fila;
    return FILAS.filter((f) => cumple(f, where)).map((f) => f.id as string);
  }

  it("lista solo los que tienen la etiqueta (el enlace de la tarea)", async () => {
    expect(await visibles("?etiqueta=falta-razon")).toEqual(["sin-razon"]);
    expect(await visibles("?etiqueta=confirmar-broker")).toEqual(["broker"]);
  });
  it("se combina con los demás filtros", async () => {
    expect(await visibles("?etiqueta=falta-razon&status=CONTACTADO")).toEqual([]);
  });
  it("vacía no filtra", async () => {
    expect(await visibles("?etiqueta=%20%20")).toEqual(["sin-razon", "broker", "sin-etiquetas"]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// #933 — la cronología no muestra los cambios de `custom` que solo tocan claves internas, y los
// de negocio salen uno por renglón. Filtrar no debe romper la paginación: la fuente sigue
// pidiendo lotes hasta juntar `limit` renglones visibles.

const rfcFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    recordFieldChange: { findMany: (...a: unknown[]) => rfcFindMany(...a) },
    user: { findMany: async () => [{ id: "u1", name: "Luis Flores" }] },
    contact: { findMany: async () => [] },
    activity: { findMany: async () => [] },
    message: { findMany: async () => [] },
    actionPlanEnrollment: { findMany: async () => [] },
  },
}));
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => ({ user: { id: "u1", role: "ADMIN", plaza: "CANCUN" } }) }));
vi.mock("@/server/contacts", () => ({
  getContactAccessInfo: async () => ({
    ok: true,
    contact: { id: "k1", assignedToId: null, createdAt: new Date("2026-01-01T00:00:00Z"), leadSource: "MESSENGER", contactStatus: "NUEVO" },
  }),
}));

import { GET } from "./route";

let n = 0;
const fila = (field: string, oldValue: unknown, newValue: unknown, source: string | null = "bot_classifier") => ({
  id: `c${++n}`,
  entityType: "contact",
  entityId: "k1",
  field,
  oldValue,
  newValue,
  actorId: "u1",
  source,
  changedAt: new Date(Date.UTC(2026, 9, 26, 12, 0, 0) - n * 1000),
});
const ruido = () => fila("custom", { bot_classification: { attempts: 1 } }, { bot_classification: { attempts: 2 } });

async function pedir(qs = "kinds=field_change&limit=5") {
  const res = await GET(new Request(`https://x/api/contacts/k1/timeline?${qs}`) as never, {
    params: Promise.resolve({ id: "k1" }),
  });
  return res.json();
}

beforeEach(() => {
  rfcFindMany.mockReset();
  n = 0;
});

describe("GET /api/contacts/[id]/timeline — campos personalizados (#933)", () => {
  it("el cambio que solo trae la clasificación del bot no aparece; nunca «[object Object]»", async () => {
    rfcFindMany.mockResolvedValueOnce([ruido(), fila("contactType", null, "BROKER_EXTERNO")]);
    const body = await pedir();
    const titulos = body.items.map((i: { title: string }) => i.title);
    expect(titulos).toEqual(["Tipo de contacto se actualizó de — a Broker"]);
    expect(JSON.stringify(body)).not.toContain("[object Object]");
  });

  it("un cambio con varios datos de negocio → un renglón por dato", async () => {
    rfcFindMany.mockResolvedValueOnce([
      fila("custom", {}, { inmobiliaria: "Independiente", broker_aporta: "AMBOS", avatarUrl: "x" }, "bot_playbook"),
    ]);
    const body = await pedir();
    expect(body.items.map((i: { title: string }) => i.title)).toEqual([
      "Qué aporta el broker se actualizó de — a Cliente y propiedad",
      "Inmobiliaria se actualizó de — a Independiente",
    ]);
    expect(body.items[0].source).toBe("Bot");
  });

  it("si el primer lote es puro ruido, pide el siguiente (no se salta los cambios reales)", async () => {
    const lote1 = Array.from({ length: 100 }, ruido); // LOTE = max(limit*2, 100) = 100
    const real = fila("leadSource", "MESSENGER", "REGISTRO_BROKER", "ui");
    rfcFindMany.mockResolvedValueOnce(lote1).mockResolvedValueOnce([real]);
    const body = await pedir();
    expect(rfcFindMany).toHaveBeenCalledTimes(2);
    expect(rfcFindMany.mock.calls[1][0].skip).toBe(100);
    expect(body.items.map((i: { title: string }) => i.title)).toEqual([
      "Fuente se actualizó de Messenger a Registro de Broker",
    ]);
  });

  it("orden estable con desempate por id (varias filas en el mismo instante)", async () => {
    rfcFindMany.mockResolvedValueOnce([]);
    await pedir();
    expect(rfcFindMany.mock.calls[0][0].orderBy).toEqual([{ changedAt: "desc" }, { id: "desc" }]);
  });

  it("la fuente del clasificador del bot ya no sale cruda", async () => {
    rfcFindMany.mockResolvedValueOnce([fila("contactType", null, "EMPLEO")]);
    const body = await pedir();
    expect(body.items[0].source).toBe("Bot (clasificador)");
  });
});

describe("GET /api/contacts/[id]/timeline — fuentes legibles (#934)", () => {
  it("lead_form_summary y las demás que salían crudas ya tienen nombre", async () => {
    rfcFindMany.mockResolvedValueOnce([
      fila("firstName", "Messenger", "Frank Arturo", "lead_form_summary"),
      fila("tags", [], ["spam"], "inbox_spam"),
      fila("assignedToId", null, "u1", "inbox_assign"),
      fila("deletedAt", null, "2026-10-16T21:00:00.000Z", "limpieza_contactos_2026_10_16"),
    ]);
    const body = await pedir("kinds=field_change&limit=10");
    expect(body.items.map((i: { source: string }) => i.source)).toEqual([
      "Formulario del anuncio (Messenger)",
      "Inbox (marcado como spam)",
      "Inbox (asignación)",
      "Limpieza de contactos (16-oct)",
    ]);
    expect(body.items[0].title).toBe("Nombre se actualizó de Messenger a Frank Arturo");
    expect(body.items[3].title).toBe("Contacto eliminado");
  });

  it("una fuente nueva sin etiqueta sale en palabras, no como identificador", async () => {
    rfcFindMany.mockResolvedValueOnce([fila("phone", "", "+529997402652", "nueva_fuente_x")]);
    const body = await pedir();
    expect(body.items[0].source).toBe("Nueva fuente x");
    expect(body.items[0].title).toBe("Teléfono se actualizó de — a +529997402652");
  });
});

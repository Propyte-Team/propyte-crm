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

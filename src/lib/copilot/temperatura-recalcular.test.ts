import { describe, it, expect, vi, beforeEach } from "vitest";

// #973 — el recálculo guarda siempre su fila en contact_temperaturas y solo toca contacts.temperature
// cuando cambia, con la fuente copilot_temperatura en la cronología.
const contactFindMany = vi.fn();
const queryRaw = vi.fn();
const upsert = vi.fn();
const executeRaw = vi.fn();
const fuentes: unknown[] = [];

vi.mock("@/lib/db", () => ({
  default: {
    contact: { findMany: (...a: unknown[]) => contactFindMany(...a) },
    contactTemperatura: { findMany: vi.fn(async () => []), findUnique: vi.fn() },
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}));
vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (opts: unknown, fn: (tx: unknown) => unknown) => {
    fuentes.push(opts);
    return fn({ contactTemperatura: { upsert: (...a: unknown[]) => upsert(...a) }, $executeRaw: (...a: unknown[]) => executeRaw(...a) });
  },
}));

import { calcularYGuardarTemperaturas, FUENTE_CAMBIO_TEMPERATURA, FUENTES_QUE_NO_SON_SENAL } from "./temperatura-recalcular";

const AHORA = new Date("2026-11-04T18:00:00Z");
const contacto = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  leadSource: "META_ADS",
  estado: "CONTACTADO",
  razonSalida: null,
  doNotContact: false,
  createdAt: new Date("2026-11-01T00:00:00Z"),
  originalCreatedAt: null,
  temperature: "COLD",
  ...extra,
});

beforeEach(() => {
  for (const m of [contactFindMany, queryRaw, upsert, executeRaw]) m.mockReset();
  fuentes.length = 0;
  upsert.mockResolvedValue({});
  executeRaw.mockResolvedValue(1);
});

describe("calcularYGuardarTemperaturas (#973)", () => {
  it("guarda la fila y cambia contacts.temperature solo si cambió", async () => {
    contactFindMany.mockResolvedValue([contacto("c1"), contacto("c2", { temperature: "WARM" })]);
    queryRaw.mockResolvedValue([
      { contactId: "c1", ultimaRespuestaAt: null, senalCompraAt: null, senalCompra: null },
      { contactId: "c2", ultimaRespuestaAt: null, senalCompraAt: null, senalCompra: null },
    ]);
    const r = await calcularYGuardarTemperaturas(["c1", "c2"], AHORA);
    expect(r).toEqual({ calculados: 2, cambiados: 1 });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0].create).toMatchObject({ contactId: "c1", temperatura: "WARM", grupo: "B", motivo: "Tibio: Meta Ads", calculadoAt: AHORA });
    expect(executeRaw).toHaveBeenCalledTimes(1); // c1: COLD → WARM; c2 ya estaba en WARM
    expect(fuentes.every((f) => (f as { source: string }).source === FUENTE_CAMBIO_TEMPERATURA)).toBe(true);
  });

  it("usa la señal de compra y la fecha original de entrada", async () => {
    contactFindMany.mockResolvedValue([
      contacto("c1", { leadSource: "WALK_IN", createdAt: new Date("2026-11-03T00:00:00Z"), originalCreatedAt: new Date("2025-01-01T00:00:00Z") }),
      contacto("c2"),
    ]);
    queryRaw.mockResolvedValue([
      { contactId: "c1", ultimaRespuestaAt: null, senalCompraAt: null, senalCompra: null },
      { contactId: "c2", ultimaRespuestaAt: new Date("2026-11-04T16:00:00Z"), senalCompraAt: new Date("2026-11-04T16:00:00Z"), senalCompra: "agendó una cita" },
    ]);
    await calcularYGuardarTemperaturas(["c1", "c2"], AHORA);
    // Walk-in importado de 2025: ya pasó sus 7 días aunque se haya creado anteayer en el CRM.
    expect(upsert.mock.calls[0][0].create).toMatchObject({ temperatura: "WARM", grupo: "A" });
    expect(upsert.mock.calls[1][0].create).toMatchObject({ temperatura: "HOT", motivo: "Caliente: agendó una cita hace 2 h", senalCompraAt: new Date("2026-11-04T16:00:00Z") });
  });

  it("No aplica se guarda como NULL en contacts.temperature", async () => {
    contactFindMany.mockResolvedValue([contacto("c1", { estado: "REGISTRADO_POR_BROKER" })]);
    queryRaw.mockResolvedValue([{ contactId: "c1", ultimaRespuestaAt: null, senalCompraAt: null, senalCompra: null }]);
    await calcularYGuardarTemperaturas(["c1"], AHORA);
    expect(upsert.mock.calls[0][0].create).toMatchObject({ temperatura: null, grupo: null });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw.mock.calls[0].slice(1)).toContain(null);
  });

  it("un llenado, una migración o una corrección del administrador no cuentan como «pasó a Reunión»", async () => {
    contactFindMany.mockResolvedValue([contacto("c1")]);
    queryRaw.mockResolvedValue([]);
    await calcularYGuardarTemperaturas(["c1"], AHORA);
    const [partes, ...valores] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(partes.join("?")).toContain('LIKE ANY');
    expect(valores).toContainEqual(FUENTES_QUE_NO_SON_SENAL);
    for (const f of ["estado_llenado_953", "estado_migracion_958", "ui_correccion_estado"]) {
      const como = (p: string) => new RegExp("^" + p.replace(/%/g, ".*") + "$");
      expect(FUENTES_QUE_NO_SON_SENAL.some((p) => como(p).test(f))).toBe(true);
    }
    expect(FUENTES_QUE_NO_SON_SENAL.some((p) => new RegExp("^" + p.replace(/%/g, ".*") + "$").test("ui"))).toBe(false);
  });

  it("sin contactos no consulta señales", async () => {
    expect(await calcularYGuardarTemperaturas([], AHORA)).toEqual({ calculados: 0, cambiados: 0 });
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

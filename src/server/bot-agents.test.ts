// #956 — Ajustes → Agentes del bot: guardar un agente que todavía tiene tipos retirados
// (LEAD, COMPRADOR, INVERSIONISTA, REFERIDOR) tronaba con un 500 sin mensaje. El formulario no
// los pintaba como chip pero los mandaba; el esquema los rechazaba y Next ocultaba el porqué.
import { describe, it, expect, vi, beforeEach } from "vitest";

const update = vi.fn();
const create = vi.fn();
const playbookFind = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    botAgentProfile: {
      update: (...a: unknown[]) => update(...a),
      create: (...a: unknown[]) => create(...a),
    },
    botPlaybook: { findFirst: (...a: unknown[]) => playbookFind(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

let sesion: { user: { id: string; role: string } } | null = null;
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));

import { upsertAgentProfile } from "./bot-agents";
import { tiposDeAgenteVigentes } from "./bot-agents.schema";

const ADMIN = { user: { id: "adm-1", role: "ADMIN" } };

// Lo que mandaba la pestaña el 30-oct para «Agente Lead Comprador»: lo guardado en la base
// (con los retirados) más los chips que se marcaron.
const COMO_EN_PRODUCCION = {
  id: "c51cdb46-1cb8-41d0-9b89-2b8066e4f155",
  name: "Agente Lead Comprador",
  contactTypes: ["LEAD", "PROSPECTO", "COMPRADOR", "INVERSIONISTA", "LEAD_COMPRADOR", "CLIENTE"],
  identity: "Hablas con alguien interesado en comprar…",
  playbookId: "pb-1",
  tonePreset: null,
  isActive: true,
  priority: 10,
};

beforeEach(() => {
  for (const m of [update, create, playbookFind, auditCreate]) m.mockReset();
  update.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
  create.mockResolvedValue({ id: "nuevo" });
  playbookFind.mockResolvedValue({ id: "pb-1" });
  auditCreate.mockResolvedValue({});
  sesion = ADMIN;
});

describe("tiposDeAgenteVigentes (#956)", () => {
  it("traduce los retirados a su reemplazo, sin repetir y en el orden en que llegan", () => {
    expect(tiposDeAgenteVigentes(COMO_EN_PRODUCCION.contactTypes)).toEqual(["LEAD_COMPRADOR", "PROSPECTO", "CLIENTE"]);
    expect(tiposDeAgenteVigentes(["REFERIDOR"])).toEqual(["BROKER_EXTERNO"]);
  });

  it("quita los que no tienen reemplazo (REFERIDO) y lo que no es texto", () => {
    expect(tiposDeAgenteVigentes(["REFERIDO", "EMPLEO", null, 3, ""])).toEqual(["EMPLEO"]);
  });
});

describe("upsertAgentProfile (#956)", () => {
  it("el caso de producción ya guarda: los retirados se traducen a Lead Comprador", async () => {
    const r = await upsertAgentProfile(COMO_EN_PRODUCCION as never);
    expect(r).toEqual({ ok: true, profile: { id: COMO_EN_PRODUCCION.id } });
    expect(update.mock.calls[0][0].data.contactTypes).toEqual(["LEAD_COMPRADOR", "PROSPECTO", "CLIENTE"]);
    expect(auditCreate.mock.calls[0][0].data.changes.contactTypes).toEqual(["LEAD_COMPRADOR", "PROSPECTO", "CLIENTE"]);
  });

  it("un perfil que solo tenía tipos sin reemplazo responde con un mensaje en español, sin lanzar", async () => {
    const r = await upsertAgentProfile({ ...COMO_EN_PRODUCCION, contactTypes: ["REFERIDO"] } as never);
    expect(r).toEqual({ ok: false, error: "Elige al menos un tipo de contacto" });
    expect(update).not.toHaveBeenCalled();
  });

  it("los errores de validación llegan legibles (no el genérico de Next)", async () => {
    const r = await upsertAgentProfile({ ...COMO_EN_PRODUCCION, name: "   ", identity: "" } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("Falta el nombre del agente");
      expect(r.error).toContain("Falta la identidad del agente");
    }
  });

  it("playbook inexistente y falta de permisos también vuelven como mensaje", async () => {
    playbookFind.mockResolvedValue(null);
    expect(await upsertAgentProfile(COMO_EN_PRODUCCION as never)).toEqual({ ok: false, error: "El playbook seleccionado no existe" });

    sesion = { user: { id: "ase-1", role: "ASESOR" } };
    const r = await upsertAgentProfile(COMO_EN_PRODUCCION as never);
    expect(r).toEqual({ ok: false, error: "Acceso denegado: se requiere rol de administración" });
  });

  it("un fallo inesperado de la base no expone el detalle técnico y no lanza", async () => {
    update.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await upsertAgentProfile(COMO_EN_PRODUCCION as never);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/^No se pudo guardar el agente/);
      expect(r.error).not.toContain("connection");
    }
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("crear uno nuevo sigue funcionando", async () => {
    const { id: _id, ...sinId } = COMO_EN_PRODUCCION;
    const r = await upsertAgentProfile({ ...sinId, name: "Agente Lead Vendedor", contactTypes: ["LEAD_VENDEDOR"] } as never);
    expect(r).toEqual({ ok: true, profile: { id: "nuevo" } });
    expect(create.mock.calls[0][0].data.contactTypes).toEqual(["LEAD_VENDEDOR"]);
  });
});

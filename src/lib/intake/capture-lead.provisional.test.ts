// Alta provisional: un comentarista NO es lead hasta que responde.
// El contacto y el hilo se crean (para verlos en el Inbox) pero sin ruteo, sin
// SLA de primer toque, sin notificación al asesor, sin lead.captured (y por
// tanto sin ascenso a MQL) y sin el evento Lead de CAPI.
import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
const create = vi.fn();
const contactUpdate = vi.fn();
const activityCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    contact: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => contactUpdate(...a),
    },
    activity: { create: (...a: unknown[]) => activityCreate(...a) },
  },
}));

const autoRouteLead = vi.fn();
vi.mock("@/lib/workflows/routing", () => ({
  autoRouteLead: (...a: unknown[]) => autoRouteLead(...a),
}));

const emitEvent = vi.fn();
vi.mock("@/lib/workflows/events", () => ({
  emitEvent: (...a: unknown[]) => emitEvent(...a),
}));

const recordConversionEvent = vi.fn();
vi.mock("@/lib/capi/events", () => ({
  recordConversionEvent: (...a: unknown[]) => recordConversionEvent(...a),
}));

import { captureLead } from "./capture-lead";

/** Tipos de evento emitidos, en orden. */
function emittedTypes(): string[] {
  return emitEvent.mock.calls.map((c) => c[0] as string);
}

const IG_LEAD = { source: "INSTAGRAM", firstName: "luisf", instagramId: "IGSID-1" };

beforeEach(() => {
  for (const m of [
    findFirst, create, contactUpdate, activityCreate,
    autoRouteLead, emitEvent, recordConversionEvent,
  ]) m.mockReset();

  findFirst.mockResolvedValue(null);
  create.mockResolvedValue({ id: "c-new", assignedToId: null, doNotContact: false });
  contactUpdate.mockResolvedValue({});
  activityCreate.mockResolvedValue({});
  autoRouteLead.mockResolvedValue("u-routed");
  recordConversionEvent.mockResolvedValue(true);
});

describe("captureLead — alta provisional", () => {
  it("provisional: no rutea (ni SLA ni notificación), no emite lead.captured, no manda CAPI", async () => {
    const r = await captureLead(IG_LEAD, { provisional: true });

    expect(autoRouteLead).not.toHaveBeenCalled();
    expect(emittedTypes()).not.toContain("lead.captured");
    expect(recordConversionEvent).not.toHaveBeenCalled();
    expect(r.assignedToId).toBeNull();
  });

  it("provisional: SÍ emite contact.created — el contacto existe de verdad", async () => {
    await captureLead(IG_LEAD, { provisional: true });

    expect(emittedTypes()).toContain("contact.created");
    expect(emitEvent).toHaveBeenCalledWith(
      "contact.created", "contact", "c-new", { leadSource: "INSTAGRAM" }
    );
  });

  it("provisional implica skipRouting: el llamador no tiene que pasar los dos", async () => {
    await captureLead(IG_LEAD, { provisional: true, connectorId: "conn-ig" });
    expect(autoRouteLead).not.toHaveBeenCalled();
  });

  // La rama de duplicado es inalcanzable desde el DM de una regla (el llamador
  // ya filtró por el mismo criterio), pero el criterio debe ser el mismo: un
  // toque provisional no asciende a nadie a MQL.
  it("provisional sobre un contacto que ya existe: tampoco emite lead.captured", async () => {
    findFirst.mockResolvedValue({ id: "c-viejo", assignedToId: "u-1" });
    const r = await captureLead(IG_LEAD, { provisional: true });

    expect(r).toMatchObject({ contactId: "c-viejo", isNew: false });
    expect(emittedTypes()).not.toContain("lead.captured");
  });

  // NO-REGRESIÓN: este es el test que protege a todos los demás llamadores del
  // intake (webhook web, conectores Meta/TikTok, WhatsApp desconocido, bots).
  // Sin la opción, el comportamiento tiene que ser exactamente el de siempre.
  it("sin la opción: rutea, emite contact.created + lead.captured y manda el Lead a CAPI", async () => {
    const r = await captureLead(IG_LEAD);

    expect(autoRouteLead).toHaveBeenCalledWith("c-new", { reason: "intake INSTAGRAM" });
    expect(emittedTypes()).toEqual(["contact.created", "lead.captured"]);
    expect(recordConversionEvent).toHaveBeenCalledWith("LEAD", expect.objectContaining({ id: "c-new" }));
    expect(r.assignedToId).toBe("u-routed");
  });

  it("sin la opción, contacto duplicado: sigue emitiendo lead.captured con duplicate true", async () => {
    findFirst.mockResolvedValue({ id: "c-viejo", assignedToId: "u-1" });
    await captureLead(IG_LEAD);

    expect(emitEvent).toHaveBeenCalledWith(
      "lead.captured", "contact", "c-viejo",
      expect.objectContaining({ duplicate: true })
    );
  });

  // skipRouting solo: sigue siendo lead (emite y manda CAPI), solo no se rutea.
  it("skipRouting sin provisional: no rutea pero SIGUE siendo un lead (evento + CAPI)", async () => {
    await captureLead(IG_LEAD, { skipRouting: true });

    expect(autoRouteLead).not.toHaveBeenCalled();
    expect(emittedTypes()).toContain("lead.captured");
    expect(recordConversionEvent).toHaveBeenCalled();
  });
});

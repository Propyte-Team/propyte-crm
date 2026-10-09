import { describe, it, expect, vi, beforeEach } from "vitest";

const convFindFirst = vi.fn();
const convCreate = vi.fn();
const convUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    conversation: {
      findFirst: (...a: unknown[]) => convFindFirst(...a),
      create: (...a: unknown[]) => convCreate(...a),
      update: (...a: unknown[]) => convUpdate(...a),
    },
  },
}));

// Marca de la cuenta (2026-10-09, marcas del agente): la adopción de hilos solo aplica entre
// cuentas de la marca predeterminada. Sin override, toda cuenta resuelve a la predeterminada.
const resolveBrandMock = vi.fn();
vi.mock("@/lib/brands/resolve", () => ({
  resolveBrandForConnector: (...a: unknown[]) => resolveBrandMock(...a),
}));

import { sameConversationKey, ensureConversation } from "./conversations";

interface ConvFixture { id: string; contactId: string; channel: string; connectorId: string | null }

/** Simula el findFirst de prisma contra fixtures respetando el where (incl. connectorId ausente). */
function setupConvs(convs: ConvFixture[]) {
  convFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
    const w = args.where;
    return (
      convs.find(
        (c) =>
          c.contactId === w.contactId &&
          c.channel === w.channel &&
          (!("connectorId" in w) || c.connectorId === w.connectorId)
      ) ?? null
    );
  });
}

describe("sameConversationKey", () => {
  it("igual contacto+canal pero distinto connector → claves distintas", () => {
    expect(sameConversationKey(
      { contactId: "a", channel: "WHATSAPP", connectorId: "n1" },
      { contactId: "a", channel: "WHATSAPP", connectorId: "n2" },
    )).toBe(false);
  });
  it("mismo contacto+canal+connector → misma clave", () => {
    expect(sameConversationKey(
      { contactId: "a", channel: "WHATSAPP", connectorId: "n1" },
      { contactId: "a", channel: "WHATSAPP", connectorId: "n1" },
    )).toBe(true);
  });
  it("connector null en ambos → misma clave", () => {
    expect(sameConversationKey(
      { contactId: "a", channel: "WEB", connectorId: null },
      { contactId: "a", channel: "WEB", connectorId: null },
    )).toBe(true);
  });
});

// Cuenta WA en el Inbox (2026-07-25): al empezar a resolver connectorId para WhatsApp,
// los hilos viejos (connectorId null) NO deben partirse en dos conversaciones.
describe("ensureConversation — adopción de hilos", () => {
  beforeEach(() => {
    convFindFirst.mockReset();
    convCreate.mockReset();
    convUpdate.mockReset();
    resolveBrandMock.mockReset();
    resolveBrandMock.mockResolvedValue({ kind: "default" });
  });

  it("match exacto (contacto+canal+connector) se reusa sin crear ni adoptar", async () => {
    setupConvs([{ id: "conv-1", contactId: "c1", channel: "WHATSAPP", connectorId: "wa-1" }]);
    const conv = await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: "wa-1" });
    expect(conv.id).toBe("conv-1");
    expect(convCreate).not.toHaveBeenCalled();
    expect(convUpdate).not.toHaveBeenCalled();
  });

  it("key CON connector + hilo legacy sin connector → lo ADOPTA (update, no crea)", async () => {
    setupConvs([{ id: "conv-legacy", contactId: "c1", channel: "WHATSAPP", connectorId: null }]);
    convUpdate.mockResolvedValue({ id: "conv-legacy", connectorId: "wa-1" });
    const conv = await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: "wa-1" });
    expect(convUpdate).toHaveBeenCalledWith({ where: { id: "conv-legacy" }, data: { connectorId: "wa-1" } });
    expect(convCreate).not.toHaveBeenCalled();
    expect(conv.connectorId).toBe("wa-1");
  });

  it("key SIN connector + existe hilo con connector → reusa el existente (no parte el hilo)", async () => {
    setupConvs([{ id: "conv-x", contactId: "c1", channel: "WHATSAPP", connectorId: "wa-1" }]);
    const conv = await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: null });
    expect(conv.id).toBe("conv-x");
    expect(convCreate).not.toHaveBeenCalled();
  });

  it("sin ningún hilo → crea con el connectorId dado", async () => {
    setupConvs([]);
    convCreate.mockResolvedValue({ id: "conv-new", connectorId: "wa-1" });
    const conv = await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: "wa-1" });
    expect(convCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ connectorId: "wa-1", status: "BOT" }) })
    );
    expect(conv.id).toBe("conv-new");
  });
});

// Marcas del agente (2026-10-09, hallazgo C2 de la revisión final): la adopción y la reutilización
// de hilos NO deben cruzar marcas. Hoy todos los hilos de WhatsApp tienen connectorId null (número
// global): si un contacto de Propyte escribe al número de Yaxnáh, adoptar su hilo lo reetiquetaría
// como de Yaxnáh y el agente de Yaxnáh recibiría como historial lo hablado con Propyte (spec §1, §2.3).
describe("ensureConversation — no cruza marcas", () => {
  const YAX = { id: "b-yax", name: "Yaxnáh Caucel", isDefault: false };
  beforeEach(() => {
    convFindFirst.mockReset();
    convCreate.mockReset();
    convUpdate.mockReset();
    resolveBrandMock.mockReset();
    resolveBrandMock.mockImplementation(async (id: string | null) =>
      id === "wa-yax" ? { kind: "brand", brand: YAX } : { kind: "default" },
    );
    convCreate.mockImplementation(async ({ data }: { data: { connectorId: string | null } }) => ({
      id: "conv-new",
      connectorId: data.connectorId,
    }));
  });

  it("cuenta de una marca NO adopta el hilo sin cuenta: crea uno propio para esa cuenta", async () => {
    setupConvs([{ id: "conv-legacy", contactId: "c1", channel: "WHATSAPP", connectorId: null }]);
    const conv = await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: "wa-yax" });
    expect(resolveBrandMock).toHaveBeenCalledWith("wa-yax");
    expect(convUpdate).not.toHaveBeenCalled();
    expect(convCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ connectorId: "wa-yax", status: "BOT" }) }),
    );
    expect(conv.id).toBe("conv-new");
  });

  it("cuenta con marca no disponible tampoco adopta (falla cerrado): crea uno propio", async () => {
    resolveBrandMock.mockResolvedValue({ kind: "unavailable", brandId: "b-x" });
    setupConvs([{ id: "conv-legacy", contactId: "c1", channel: "WHATSAPP", connectorId: null }]);
    await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: "wa-roto" });
    expect(convUpdate).not.toHaveBeenCalled();
    expect(convCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ connectorId: "wa-roto" }) }),
    );
  });

  it("cuenta de la predeterminada SÍ adopta el hilo sin cuenta (sin cambio)", async () => {
    setupConvs([{ id: "conv-legacy", contactId: "c1", channel: "WHATSAPP", connectorId: null }]);
    convUpdate.mockResolvedValue({ id: "conv-legacy", connectorId: "wa-prop" });
    const conv = await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: "wa-prop" });
    expect(resolveBrandMock).toHaveBeenCalledWith("wa-prop");
    expect(convUpdate).toHaveBeenCalledWith({ where: { id: "conv-legacy" }, data: { connectorId: "wa-prop" } });
    expect(convCreate).not.toHaveBeenCalled();
    expect(conv.id).toBe("conv-legacy");
  });

  it("key sin cuenta NO reusa el hilo de una marca: crea un hilo sin cuenta", async () => {
    setupConvs([{ id: "conv-yax", contactId: "c1", channel: "WHATSAPP", connectorId: "wa-yax" }]);
    const conv = await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: null });
    expect(resolveBrandMock).toHaveBeenCalledWith("wa-yax");
    expect(conv.id).toBe("conv-new");
    expect(convCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ connectorId: null, status: "BOT" }) }),
    );
    expect(convUpdate).not.toHaveBeenCalled();
  });

  it("key sin cuenta NO reusa un hilo cuya marca no se puede resolver", async () => {
    resolveBrandMock.mockResolvedValue({ kind: "unavailable", brandId: "b-x" });
    setupConvs([{ id: "conv-roto", contactId: "c1", channel: "WHATSAPP", connectorId: "wa-roto" }]);
    const conv = await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: null });
    expect(conv.id).toBe("conv-new");
  });

  it("key sin cuenta reusa el hilo más reciente si es de la predeterminada (sin cambio)", async () => {
    setupConvs([{ id: "conv-prop", contactId: "c1", channel: "WHATSAPP", connectorId: "wa-prop" }]);
    const conv = await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: null });
    expect(conv.id).toBe("conv-prop");
    expect(convCreate).not.toHaveBeenCalled();
  });

  it("key sin cuenta con hilo sin cuenta: lo reusa sin resolver ninguna marca (sin cambio)", async () => {
    setupConvs([{ id: "conv-null", contactId: "c1", channel: "WHATSAPP", connectorId: null }]);
    const conv = await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: null });
    expect(conv.id).toBe("conv-null");
    expect(resolveBrandMock).not.toHaveBeenCalled();
    expect(convCreate).not.toHaveBeenCalled();
  });

  it("sin hilo que adoptar ni reusar no se resuelve ninguna marca (sin consultas nuevas)", async () => {
    setupConvs([]);
    await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: "wa-prop" });
    await ensureConversation({ contactId: "c1", channel: "WHATSAPP", connectorId: null });
    expect(resolveBrandMock).not.toHaveBeenCalled();
    expect(convCreate).toHaveBeenCalledTimes(2);
  });
});

// WhatsApp propio de un asesor — «posibles prospectos» y dueño del contacto (2026-10-14, PR 2).
// Decisión 1 del dueño: de un desconocido solo se guarda quién es y cuántas veces escribió; el
// asesor decide «Es prospecto» (se crea el contacto, asignado a él) o «Ignorar».
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pendingFindFirst = vi.fn();
const pendingCreate = vi.fn();
const pendingUpdate = vi.fn();
const pendingUpdateMany = vi.fn();
const pendingFindMany = vi.fn();
const connFindUnique = vi.fn();
const contactUpdateMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    whatsappPendingProspect: {
      findFirst: (...a: unknown[]) => pendingFindFirst(...a),
      create: (...a: unknown[]) => pendingCreate(...a),
      update: (...a: unknown[]) => pendingUpdate(...a),
      updateMany: (...a: unknown[]) => pendingUpdateMany(...a),
      findMany: (...a: unknown[]) => pendingFindMany(...a),
    },
    leadConnector: { findUnique: (...a: unknown[]) => connFindUnique(...a) },
    contact: { updateMany: (...a: unknown[]) => contactUpdateMany(...a) },
  },
}));
const findWhatsAppContact = vi.fn();
vi.mock("@/lib/messaging/core", () => ({ findWhatsAppContact: (...a: unknown[]) => findWhatsAppContact(...a) }));
const captureLead = vi.fn();
vi.mock("@/lib/intake/capture-lead", () => ({ captureLead: (...a: unknown[]) => captureLead(...a) }));
const txContactUpdateMany = vi.fn();
const withChangeSource = vi.fn();
vi.mock("@/lib/audit/change-context", () => ({ withChangeSource: (...a: unknown[]) => withChangeSource(...a) }));

import {
  assignToAdvisorIfUnowned,
  enrichPendingProspectName,
  ignorePendingProspect,
  listPendingProspects,
  promotePendingProspect,
  recordPendingProspect,
} from "./asesor";

const ADVISOR = { id: "conn-ana", scope: "ADVISOR" as const, ownerUserId: "u-ana" };
const BRAND = { id: "conn-yax", scope: "BRAND" as const, ownerUserId: null };
const AT = new Date("2026-10-14T15:00:00Z");

beforeEach(() => {
  for (const m of [pendingFindFirst, pendingCreate, pendingUpdate, pendingUpdateMany, pendingFindMany, connFindUnique, contactUpdateMany, findWhatsAppContact, captureLead, txContactUpdateMany, withChangeSource]) m.mockReset();
  pendingCreate.mockImplementation(async (args: { data: unknown }) => ({ id: "p-new", ...(args.data as object) }));
  pendingUpdate.mockImplementation(async (args: { data: unknown }) => ({ id: "p-1", ...(args.data as object) }));
  txContactUpdateMany.mockResolvedValue({ count: 1 });
  withChangeSource.mockImplementation(async (_o: unknown, fn: (tx: unknown) => unknown) => fn({ contact: { updateMany: txContactUpdateMany } }));
  contactUpdateMany.mockResolvedValue({ count: 0 });
  connFindUnique.mockResolvedValue(ADVISOR);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("recordPendingProspect — solo metadatos", () => {
  it("primer mensaje de un desconocido → crea el registro con contadores y SIN texto ni media", async () => {
    pendingFindFirst.mockResolvedValue(null);
    await recordPendingProspect(ADVISOR, { phone: "+529981234567", bsuid: "MX.1", profileName: "Juan", at: AT });
    const data = pendingCreate.mock.calls[0][0].data;
    expect(data).toEqual({
      connectorId: "conn-ana",
      ownerUserId: "u-ana",
      senderKey: "+529981234567",
      phone: "+529981234567",
      waUserId: "MX.1",
      profileName: "Juan",
      firstSeenAt: AT,
      lastSeenAt: AT,
      messageCount: 1,
      status: "PENDING",
    });
    // 🚨 el modelo no tiene dónde guardar el mensaje: ni body, ni media
    expect(Object.keys(data).some((k) => /body|text|media/i.test(k))).toBe(false);
  });

  it("siguiente mensaje → suma uno y mueve la última vez visto", async () => {
    pendingFindFirst.mockResolvedValue({ id: "p-1", status: "PENDING", lastSeenAt: new Date("2026-10-01"), phone: "+529981234567", waUserId: null });
    await recordPendingProspect(ADVISOR, { phone: "+529981234567", bsuid: "MX.1", profileName: null, at: AT });
    expect(pendingUpdate).toHaveBeenCalledWith({
      where: { id: "p-1" },
      data: { lastSeenAt: AT, messageCount: { increment: 1 }, waUserId: "MX.1" },
    });
  });

  it("uno ignorado no se vuelve a tocar", async () => {
    pendingFindFirst.mockResolvedValue({ id: "p-1", status: "IGNORED", lastSeenAt: AT });
    expect(await recordPendingProspect(ADVISOR, { phone: "+529981234567", bsuid: null, profileName: "x", at: AT })).toBeNull();
    expect(pendingUpdate).not.toHaveBeenCalled();
    expect(pendingCreate).not.toHaveBeenCalled();
  });

  it("uno «prospecto» cuyo contacto ya no existe vuelve a pendiente", async () => {
    pendingFindFirst.mockResolvedValue({ id: "p-1", status: "PROMOTED", contactId: "c-borrado", lastSeenAt: new Date("2026-10-01"), phone: "+529981234567", waUserId: "MX.1" });
    await recordPendingProspect(ADVISOR, { phone: "+529981234567", bsuid: "MX.1", profileName: null, at: AT });
    expect(pendingUpdate.mock.calls[0][0].data).toMatchObject({ status: "PENDING", contactId: null });
  });

  it("sin teléfono se identifica por BSUID; sin nada no se registra", async () => {
    pendingFindFirst.mockResolvedValue(null);
    await recordPendingProspect(ADVISOR, { phone: null, bsuid: "MX.9", profileName: null, at: AT });
    expect(pendingCreate.mock.calls[0][0].data).toMatchObject({ senderKey: "MX.9", phone: null, waUserId: "MX.9" });
    expect(await recordPendingProspect(ADVISOR, { phone: null, bsuid: null, profileName: null, at: AT })).toBeNull();
  });

  it("carrera de dos mensajes (P2002) → no lanza", async () => {
    pendingFindFirst.mockResolvedValue(null);
    pendingCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(recordPendingProspect(ADVISOR, { phone: "+529981234567", bsuid: null, profileName: null, at: AT })).resolves.toBeNull();
  });
});

describe("assignToAdvisorIfUnowned — el contacto conserva su asesor", () => {
  it("sin asesor → se le asigna al dueño del número, con su origen en la cronología", async () => {
    expect(await assignToAdvisorIfUnowned({ id: "c1", assignedToId: null }, ADVISOR)).toBe(true);
    expect(withChangeSource).toHaveBeenCalledWith({ source: "whatsapp_asesor", actorId: "u-ana" }, expect.any(Function));
    expect(txContactUpdateMany).toHaveBeenCalledWith({ where: { id: "c1", assignedToId: null }, data: { assignedToId: "u-ana" } });
  });
  it("🚨 con asesor → no se le quita", async () => {
    expect(await assignToAdvisorIfUnowned({ id: "c1", assignedToId: "u-otro" }, ADVISOR)).toBe(false);
    expect(withChangeSource).not.toHaveBeenCalled();
  });
  it("en una línea de marca no aplica", async () => {
    expect(await assignToAdvisorIfUnowned({ id: "c1", assignedToId: null }, BRAND)).toBe(false);
    expect(withChangeSource).not.toHaveBeenCalled();
  });
});

describe("«Es prospecto»", () => {
  const PENDING = { id: "p-1", connectorId: "conn-ana", ownerUserId: "u-ana", status: "PENDING", phone: "+529981234567", waUserId: "MX.1", profileName: "Juan Pérez", contactName: null, contactId: null };

  it("crea el contacto sin reparto, se lo asigna al asesor y marca el registro", async () => {
    pendingFindFirst.mockResolvedValue(PENDING);
    findWhatsAppContact.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "c-new", assignedToId: null });
    captureLead.mockResolvedValue({ contactId: "c-new", isNew: true, assignedToId: null });
    const r = await promotePendingProspect("p-1", "u-ana");
    expect(r).toEqual({ ok: true, status: "PROMOTED", contactId: "c-new", created: true });
    // solo el dueño: la búsqueda filtra por dueño y por cuenta de asesor del mismo dueño
    expect(pendingFindFirst).toHaveBeenCalledWith({ where: { id: "p-1", ownerUserId: "u-ana", connector: { scope: "ADVISOR", ownerUserId: "u-ana" } } });
    expect(captureLead).toHaveBeenCalledWith(
      { source: "WHATSAPP", firstName: "Juan", lastName: "Pérez", phone: "+529981234567" },
      { connectorId: "conn-ana", skipRouting: true },
    );
    expect(txContactUpdateMany).toHaveBeenCalledWith({ where: { id: "c-new", assignedToId: null }, data: { assignedToId: "u-ana" } });
    expect(contactUpdateMany).toHaveBeenCalledWith({ where: { id: "c-new", whatsappUserId: null }, data: { whatsappUserId: "MX.1" } });
    expect(pendingUpdate).toHaveBeenCalledWith({ where: { id: "p-1" }, data: { status: "PROMOTED", contactId: "c-new" } });
  });

  it("si ya existía un contacto con ese número se usa ese y NO se le cambia el asesor", async () => {
    pendingFindFirst.mockResolvedValue(PENDING);
    findWhatsAppContact.mockResolvedValue({ id: "c-viejo", assignedToId: "u-otro" });
    const r = await promotePendingProspect("p-1", "u-ana");
    expect(r).toMatchObject({ ok: true, contactId: "c-viejo", created: false });
    expect(captureLead).not.toHaveBeenCalled();
    expect(txContactUpdateMany).not.toHaveBeenCalled();
  });

  it("sin teléfono (solo BSUID) → 422 explicando por qué", async () => {
    pendingFindFirst.mockResolvedValue({ ...PENDING, phone: null });
    const r = await promotePendingProspect("p-1", "u-ana");
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(captureLead).not.toHaveBeenCalled();
  });

  it("🚨 el de otro asesor (o inexistente) → 404", async () => {
    pendingFindFirst.mockResolvedValue(null);
    expect(await promotePendingProspect("p-1", "u-otro")).toMatchObject({ ok: false, status: 404 });
    expect(await ignorePendingProspect("p-1", "u-otro")).toMatchObject({ ok: false, status: 404 });
    expect(pendingUpdate).not.toHaveBeenCalled();
  });
});

describe("«Ignorar» y la lista", () => {
  it("ignorar lo saca de la lista", async () => {
    pendingFindFirst.mockResolvedValue({ id: "p-1", status: "PENDING" });
    expect(await ignorePendingProspect("p-1", "u-ana")).toEqual({ ok: true, status: "IGNORED" });
    expect(pendingUpdate).toHaveBeenCalledWith({ where: { id: "p-1" }, data: { status: "IGNORED" } });
  });

  it("la lista es solo del asesor, solo pendientes y sin nada del contenido", async () => {
    pendingFindMany.mockResolvedValue([]);
    await listPendingProspects("u-ana");
    const args = pendingFindMany.mock.calls[0][0];
    expect(args.where).toEqual({ ownerUserId: "u-ana", status: "PENDING", connector: { scope: "ADVISOR", ownerUserId: "u-ana", deletedAt: null } });
    expect(Object.keys(args.select).sort()).toEqual(["contactName", "firstSeenAt", "id", "lastSeenAt", "messageCount", "phone", "profileName", "waUserId"]);
  });

  it("el nombre de la libreta solo llega a un pendiente (nunca crea)", async () => {
    pendingUpdateMany.mockResolvedValue({ count: 1 });
    expect(await enrichPendingProspectName("conn-ana", "+529981234567", "Juan del depa")).toBe(true);
    expect(pendingUpdateMany).toHaveBeenCalledWith({
      where: { connectorId: "conn-ana", phone: "+529981234567", status: "PENDING" },
      data: { contactName: "Juan del depa" },
    });
  });
});

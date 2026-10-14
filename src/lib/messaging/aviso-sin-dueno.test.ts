import { describe, it, expect, vi, beforeEach } from "vitest";

// #858 (2026-10-14): una conversación en HUMAN sin controlledById y con el contacto sin
// asesor no le avisaba a nadie. Caso real: el valuador de BBVA del 2026-10-12 (conversación
// 9c1379d8) esperó dos días. Aquí se prueba a quién se avisa y que no se avise de más.

const userFindFirst = vi.fn();
const userFindMany = vi.fn();
const notifFindMany = vi.fn();
const notifCreateMany = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    user: {
      findFirst: (...a: unknown[]) => userFindFirst(...a),
      findMany: (...a: unknown[]) => userFindMany(...a),
    },
    notification: {
      findMany: (...a: unknown[]) => notifFindMany(...a),
      createMany: (...a: unknown[]) => notifCreateMany(...a),
    },
  },
}));
const resolveBrandForConnector = vi.fn();
vi.mock("@/lib/brands/resolve", () => ({
  resolveBrandForConnector: (...a: unknown[]) => resolveBrandForConnector(...a),
}));

import { avisarHiloSinDueno, destinatariosHiloSinDueno, VENTANA_DEDUP_AVISO_MS } from "./aviso-sin-dueno";

const LUIS = "u-luis";
const YAX = { id: "b-yax", name: "Yaxnáh Caucel", isDefault: false, defaultPlaza: "MERIDA", marketingOwnerUserId: LUIS };

/** Gente falsa: gerencia por plaza (consulta con `role: { in }`) y ADMIN persona (`role: "ADMIN"`). */
function gente(opts: { gerencia?: Record<string, string[]>; admins?: string[]; personas?: string[] }) {
  userFindMany.mockImplementation(async ({ where }: { where: { role: unknown; plaza?: string } }) => {
    if (where.role === "ADMIN") return (opts.admins ?? []).map((id) => ({ id }));
    const ids = where.plaza ? opts.gerencia?.[where.plaza] ?? [] : Object.values(opts.gerencia ?? {}).flat();
    return ids.map((id) => ({ id }));
  });
  userFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
    (opts.personas ?? []).includes(where.id) ? { id: where.id } : null,
  );
}

const AVISO = {
  conversationId: "conv-1",
  connectorId: null as string | null,
  plaza: null as string | null,
  title: "El bot pasó una conversación sin asesor",
  message: "Valuador BBVA: pide coordinar el avalúo",
  type: "bot_escalation",
};

beforeEach(() => {
  vi.resetAllMocks();
  resolveBrandForConnector.mockResolvedValue({ kind: "default" });
  notifFindMany.mockResolvedValue([]);
  notifCreateMany.mockResolvedValue({ count: 0 });
});

describe("destinatariosHiloSinDueno — a quién, en orden", () => {
  it("1) cuenta de una marca no predeterminada → su responsable de marketing, y nadie más", async () => {
    resolveBrandForConnector.mockResolvedValue({ kind: "brand", brand: YAX });
    gente({ personas: [LUIS], gerencia: { MERIDA: ["dir-mid"] }, admins: ["admin-1"] });
    const r = await destinatariosHiloSinDueno({ connectorId: "c-yax", plaza: "MERIDA" });
    expect(r).toEqual({ userIds: [LUIS], via: "responsable_marca", detalle: "Yaxnáh Caucel" });
    expect(resolveBrandForConnector).toHaveBeenCalledWith("c-yax");
  });

  it("el responsable de la marca tiene que ser persona activa: se filtra con el criterio del reparto", async () => {
    resolveBrandForConnector.mockResolvedValue({ kind: "brand", brand: YAX });
    gente({ personas: [], gerencia: { MERIDA: ["dir-mid"] } });
    const r = await destinatariosHiloSinDueno({ connectorId: "c-yax", plaza: "MERIDA" });
    expect(userFindFirst.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ id: LUIS, isActive: true, deletedAt: null, NOT: { email: { endsWith: ".local" } } }),
    );
    // inactivo o técnico → se sigue con la gerencia de la plaza
    expect(r).toEqual({ userIds: ["dir-mid"], via: "gerencia_plaza", detalle: "MERIDA" });
  });

  it("2) marca predeterminada (o sin cuenta) → gerencia de la plaza del contacto", async () => {
    gente({ gerencia: { PDC: ["ger-pdc", "dir-pdc"], TULUM: ["ger-tul"] }, admins: ["admin-1"] });
    const r = await destinatariosHiloSinDueno({ connectorId: null, plaza: "PDC" });
    expect(r).toEqual({ userIds: ["ger-pdc", "dir-pdc"], via: "gerencia_plaza", detalle: "PDC" });
    expect(userFindFirst).not.toHaveBeenCalled(); // sin marca no se busca responsable
  });

  it("marca no disponible (cuenta con marca borrada) no avisa a nadie de esa marca: sigue con la gerencia", async () => {
    resolveBrandForConnector.mockResolvedValue({ kind: "unavailable", brandId: "b-x" });
    gente({ gerencia: { PDC: ["ger-pdc"] } });
    const r = await destinatariosHiloSinDueno({ connectorId: "c-x", plaza: "PDC" });
    expect(r.via).toBe("gerencia_plaza");
  });

  it("3) sin plaza → ADMIN persona (no toda la gerencia de todas las plazas)", async () => {
    gente({ gerencia: { PDC: ["ger-pdc"] }, admins: ["admin-1", "admin-2"] });
    const r = await destinatariosHiloSinDueno({ connectorId: null, plaza: null });
    expect(r).toEqual({ userIds: ["admin-1", "admin-2"], via: "admins", detalle: null });
    const adminWhere = userFindMany.mock.calls.find((c) => c[0].where.role === "ADMIN")![0].where;
    expect(adminWhere).toEqual(expect.objectContaining({ isActive: true, deletedAt: null, NOT: { email: { endsWith: ".local" } } }));
  });

  it("plaza sin gerencia → ADMIN persona", async () => {
    gente({ gerencia: { PDC: ["ger-pdc"] }, admins: ["admin-1"] });
    const r = await destinatariosHiloSinDueno({ connectorId: null, plaza: "MERIDA" });
    expect(r).toEqual({ userIds: ["admin-1"], via: "admins", detalle: null });
  });

  it("nadie en absoluto → lista vacía", async () => {
    gente({});
    const r = await destinatariosHiloSinDueno({ connectorId: null, plaza: null });
    expect(r).toEqual({ userIds: [], via: null, detalle: null });
  });
});

describe("avisarHiloSinDueno", () => {
  it("crea UN aviso por destinatario con el enlace del hilo, y dice por qué le llega", async () => {
    resolveBrandForConnector.mockResolvedValue({ kind: "brand", brand: YAX });
    gente({ personas: [LUIS] });
    const r = await avisarHiloSinDueno({ ...AVISO, connectorId: "c-yax", plaza: "MERIDA" });
    expect(r).toEqual([LUIS]);
    expect(notifCreateMany).toHaveBeenCalledTimes(1);
    const [fila] = notifCreateMany.mock.calls[0][0].data;
    expect(fila).toEqual(
      expect.objectContaining({ userId: LUIS, title: AVISO.title, type: "bot_escalation", link: "/inbox?c=conv-1" }),
    );
    expect(fila.message).toContain(AVISO.message);
    expect(fila.message).toContain("responsable de la marca «Yaxnáh Caucel»");
  });

  it("dedup por hilo: a quien ya tiene un aviso SIN LEER de ese hilo en la ventana no se le repite", async () => {
    gente({ admins: ["admin-1", "admin-2"] });
    notifFindMany.mockResolvedValue([{ userId: "admin-1" }]);
    const antes = Date.now();
    const r = await avisarHiloSinDueno(AVISO);
    expect(r).toEqual(["admin-2"]);
    const where = notifFindMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({ userId: { in: ["admin-1", "admin-2"] }, link: "/inbox?c=conv-1", isRead: false }),
    );
    const desde = (where.createdAt.gte as Date).getTime();
    expect(desde).toBeGreaterThanOrEqual(antes - VENTANA_DEDUP_AVISO_MS - 1000);
    expect(desde).toBeLessThanOrEqual(Date.now() - VENTANA_DEDUP_AVISO_MS + 1000);
    expect(notifCreateMany.mock.calls[0][0].data.map((d: { userId: string }) => d.userId)).toEqual(["admin-2"]);
  });

  it("todos ya avisados → no crea nada", async () => {
    gente({ admins: ["admin-1"] });
    notifFindMany.mockResolvedValue([{ userId: "admin-1" }]);
    const r = await avisarHiloSinDueno(AVISO);
    expect(r).toEqual([]);
    expect(notifCreateMany).not.toHaveBeenCalled();
  });

  it("sin nadie a quien avisar: deja rastro en el log y no crea nada", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    gente({});
    const r = await avisarHiloSinDueno(AVISO);
    expect(r).toEqual([]);
    expect(notifCreateMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("conv-1"));
    warn.mockRestore();
  });

  it("nunca lanza: un fallo de la base se registra y devuelve []", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    userFindMany.mockRejectedValue(new Error("db caída"));
    await expect(avisarHiloSinDueno(AVISO)).resolves.toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

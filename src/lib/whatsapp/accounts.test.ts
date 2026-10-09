import { describe, it, expect, vi, beforeEach } from "vitest";

// resolveWhatsAppSender se prueba con el resolvedor de marcas REAL (src/lib/brands/resolve.ts)
// contra un prisma simulado; las credenciales viajan en claro en el doble de readCredentials.
const connectorFindFirst = vi.fn();
const connectorFindUnique = vi.fn();
const brandFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: {
      findFirst: (...a: unknown[]) => connectorFindFirst(...a),
      findUnique: (...a: unknown[]) => connectorFindUnique(...a),
    },
    brand: { findFirst: (...a: unknown[]) => brandFindFirst(...a) },
  },
}));
vi.mock("@/lib/intake/connectors", () => ({
  readCredentials: (c: { credentials?: unknown }) => c.credentials ?? null,
}));

import { getWhatsAppCredentials, resolveWhatsAppSender } from "./accounts";

const fakeConnector = (config: any, creds: any) => ({
  id: "c1", provider: "WHATSAPP", config,
  __decrypted: creds,
} as any);

describe("getWhatsAppCredentials", () => {
  it("combina phoneNumberId (config) + secretos (credentials)", () => {
    const conn = fakeConnector(
      { phoneNumberId: "111", brand: "Nativa" },
      { accessToken: "tok", verifyToken: "vt", appSecret: "sec" },
    );
    const creds = getWhatsAppCredentials(conn, () => conn.__decrypted);
    expect(creds).toEqual({ phoneNumberId: "111", accessToken: "tok", verifyToken: "vt", appSecret: "sec", brand: "Nativa" });
  });
  it("retorna null si falta phoneNumberId o accessToken", () => {
    expect(getWhatsAppCredentials(fakeConnector({}, { accessToken: "t" }), (c) => (c as any).__decrypted)).toBeNull();
    expect(getWhatsAppCredentials(fakeConnector({ phoneNumberId: "1" }, {}), (c) => (c as any).__decrypted)).toBeNull();
  });
});

// Hallazgo I2 de la revisión final (marcas del agente, 2026-10-09): si la cuenta del hilo está
// BORRADA, `null` ("usa el número global") haría que el cliente de una marca recibiera la
// respuesta desde el WhatsApp de Propyte. Cuenta borrada de una marca no predeterminada (o cuya
// marca no se puede leer) → lanza, igual que la cuenta sin credenciales. Sin marca o con la
// predeterminada → null, como siempre.
describe("resolveWhatsAppSender", () => {
  /** `activa`: la del findFirst con deletedAt null; `borrada`: la del findFirst con deletedAt no nulo. */
  function setConnectors(opts: { activa?: unknown; borrada?: { id: string; name: string; brandId: string | null } }) {
    connectorFindFirst.mockImplementation(async ({ where }: { where: { deletedAt: unknown } }) =>
      where.deletedAt === null
        ? (opts.activa ?? null)
        : opts.borrada
          ? { id: opts.borrada.id, name: opts.borrada.name }
          : null,
    );
    connectorFindUnique.mockImplementation(async () => (opts.borrada ? { brandId: opts.borrada.brandId } : null));
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sin connectorId → null (número global) sin consultar nada", async () => {
    expect(await resolveWhatsAppSender(null)).toBeNull();
    expect(await resolveWhatsAppSender(undefined)).toBeNull();
    expect(connectorFindFirst).not.toHaveBeenCalled();
  });

  it("cuenta activa con credenciales → sus credenciales, con una sola consulta (sin cambio)", async () => {
    setConnectors({
      activa: { id: "wa-1", name: "WA Nativa", provider: "WHATSAPP", config: { phoneNumberId: "111" }, credentials: { accessToken: "tok" } },
    });
    expect(await resolveWhatsAppSender("wa-1")).toEqual(
      expect.objectContaining({ phoneNumberId: "111", accessToken: "tok" }),
    );
    expect(connectorFindFirst).toHaveBeenCalledTimes(1);
    expect(connectorFindFirst).toHaveBeenCalledWith({ where: { id: "wa-1", provider: "WHATSAPP", deletedAt: null } });
  });

  it("cuenta activa SIN credenciales → lanza (sin cambio)", async () => {
    setConnectors({ activa: { id: "wa-1", name: "WA Nativa", provider: "WHATSAPP", config: {}, credentials: null } });
    await expect(resolveWhatsAppSender("wa-1")).rejects.toThrow(/no tiene phoneNumberId o accessToken/);
  });

  it("cuenta inexistente → null (sin cambio)", async () => {
    setConnectors({});
    expect(await resolveWhatsAppSender("wa-x")).toBeNull();
    expect(brandFindFirst).not.toHaveBeenCalled();
  });

  it("cuenta BORRADA sin marca → null, número global (sin cambio)", async () => {
    setConnectors({ borrada: { id: "wa-old", name: "WA vieja", brandId: null } });
    expect(await resolveWhatsAppSender("wa-old")).toBeNull();
    expect(brandFindFirst).not.toHaveBeenCalled();
  });

  it("cuenta BORRADA de la marca predeterminada → null, número global (sin cambio)", async () => {
    setConnectors({ borrada: { id: "wa-old", name: "WA vieja", brandId: "b-def" } });
    brandFindFirst.mockResolvedValue({ id: "b-def", isDefault: true });
    expect(await resolveWhatsAppSender("wa-old")).toBeNull();
  });

  it("🚨 cuenta BORRADA de una marca NO predeterminada → lanza (no sale por el número global)", async () => {
    setConnectors({ borrada: { id: "wa-yax", name: "WA Yaxnáh", brandId: "b-yax" } });
    brandFindFirst.mockResolvedValue({ id: "b-yax", isDefault: false, name: "Yaxnáh Caucel" });
    await expect(resolveWhatsAppSender("wa-yax")).rejects.toThrow(/WA Yaxnáh.*eliminado/);
    // la búsqueda de la cuenta borrada es por id + WHATSAPP + deletedAt no nulo
    expect(connectorFindFirst).toHaveBeenLastCalledWith({
      where: { id: "wa-yax", provider: "WHATSAPP", deletedAt: { not: null } },
      select: { id: true, name: true },
    });
  });

  it("cuenta BORRADA cuya marca ya no existe o está borrada → lanza (falla cerrado) y lo registra", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setConnectors({ borrada: { id: "wa-yax", name: "WA Yaxnáh", brandId: "b-yax" } });
    brandFindFirst.mockResolvedValue(null);
    await expect(resolveWhatsAppSender("wa-yax")).rejects.toThrow(/WA Yaxnáh/);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[brands]"), "wa-yax", "b-yax");
    error.mockRestore();
  });

  it("cuenta BORRADA cuya marca no se puede leer → lanza (falla cerrado) y lo registra", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setConnectors({ borrada: { id: "wa-yax", name: "WA Yaxnáh", brandId: "b-yax" } });
    brandFindFirst.mockRejectedValue(new Error("db caída"));
    await expect(resolveWhatsAppSender("wa-yax")).rejects.toThrow(/WA Yaxnáh/);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[brands]"), "b-yax", expect.any(Error));
    error.mockRestore();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

// Marcas (2026-10-09, spec marcas-agente §4.2): con 2+ cuentas META activas (2+ marcas),
// un `page_id` que no pertenece a ninguna cuenta caía en la cuenta cuya firma validó, y el
// lead se contaba como de otra marca. Con una sola cuenta se conserva el respaldo
// (instalación de una sola página), que es el comportamiento de siempre.

const connectorFindMany = vi.fn();
const reservarLeadEntrante = vi.fn();
const processIncomingLead = vi.fn();
const marcarLeadFallido = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: { findMany: (...a: unknown[]) => connectorFindMany(...a) },
  },
}));

// `credentials` viaja en claro en el doble: el cifrado no es lo que se prueba aquí.
vi.mock("@/lib/intake/connectors", () => ({
  readCredentials: (c: { credentials?: unknown }) => c.credentials ?? null,
  reservarLeadEntrante: (...a: unknown[]) => reservarLeadEntrante(...a),
  processIncomingLead: (...a: unknown[]) => processIncomingLead(...a),
  marcarLeadFallido: (...a: unknown[]) => marcarLeadFallido(...a),
}));

import { POST } from "./route";

const URL_WEBHOOK = "https://x/api/connectors/meta/webhook";

/** Cuenta META activa con sus credenciales en claro. */
function cuenta(id: string, pageId: string, appSecret: string) {
  return {
    id,
    provider: "META",
    status: "ACTIVE",
    config: {},
    fieldMap: null,
    credentials: { pageId, pageAccessToken: `tok-${id}`, appSecret, verifyToken: `vt-${id}` },
  };
}

const CUENTA_A = cuenta("conn-A", "PAGE-A", "secret-A");
const CUENTA_B = cuenta("conn-B", "PAGE-B", "secret-B");

function leadgen(pageId: string, leadgenId = "lg-1") {
  return JSON.stringify({
    entry: [{ changes: [{ value: { leadgen_id: leadgenId, form_id: "form-1", page_id: pageId } }] }],
  });
}

/** POST firmado con el appSecret dado (el que Meta usaría para esa app). */
function postFirmado(body: string, appSecret: string) {
  const firma = "sha256=" + createHmac("sha256", appSecret).update(body, "utf8").digest("hex");
  return POST(
    new Request(URL_WEBHOOK, {
      method: "POST",
      body,
      headers: { "x-hub-signature-256": firma },
    }) as never,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  connectorFindMany.mockReset();
  reservarLeadEntrante.mockReset().mockResolvedValue({ logId: "log-1", yaProcesado: false });
  processIncomingLead.mockReset().mockResolvedValue({ status: "PROCESSED", contactId: "c1" });
  marcarLeadFallido.mockReset().mockResolvedValue(undefined);
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ field_data: [{ name: "full_name", values: ["Ana"] }], campaign_name: "Camp" }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("webhook de Lead Ads — asignación estricta de página a cuenta", () => {
  it("🚨 con DOS cuentas META y un page_id sin cuenta: el lead NO se reserva, se avisa con el page_id y responde 200", async () => {
    connectorFindMany.mockResolvedValue([CUENTA_A, CUENTA_B]);

    // La firma valida con la A, pero la página "PAGE-X" no es de ninguna: antes caía en la A.
    const res = await postFirmado(leadgen("PAGE-X"), "secret-A");

    expect(res.status).toBe(200);
    expect(reservarLeadEntrante).not.toHaveBeenCalled();
    expect(processIncomingLead).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled(); // ni siquiera se pidió el detalle a Graph
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toContain("PAGE-X");
  });

  it("con UNA sola cuenta META y un page_id distinto: se procesa con esa cuenta, como hoy", async () => {
    connectorFindMany.mockResolvedValue([CUENTA_A]);

    const res = await postFirmado(leadgen("PAGE-X"), "secret-A");

    expect(res.status).toBe(200);
    expect(reservarLeadEntrante).toHaveBeenCalledTimes(1);
    expect(reservarLeadEntrante.mock.calls[0][0]).toBe("conn-A");
    expect(processIncomingLead).toHaveBeenCalledTimes(1);
    expect(processIncomingLead.mock.calls[0][0]).toBe("conn-A");
    expect(fetchMock.mock.calls[0][0]).toContain("access_token=tok-conn-A");
    expect(warn).not.toHaveBeenCalled();
  });

  it("con DOS cuentas y un page_id que coincide con la B: se procesa con la B (con su token)", async () => {
    connectorFindMany.mockResolvedValue([CUENTA_A, CUENTA_B]);

    // Misma firma de la A: lo que decide la cuenta es la página, no quién firmó.
    const res = await postFirmado(leadgen("PAGE-B"), "secret-A");

    expect(res.status).toBe(200);
    expect(reservarLeadEntrante).toHaveBeenCalledTimes(1);
    expect(reservarLeadEntrante.mock.calls[0][0]).toBe("conn-B");
    expect(processIncomingLead).toHaveBeenCalledTimes(1);
    expect(processIncomingLead.mock.calls[0][0]).toBe("conn-B");
    expect(fetchMock.mock.calls[0][0]).toContain("access_token=tok-conn-B");
    expect(warn).not.toHaveBeenCalled();
  });

  it("con dos cuentas, un lead sin cuenta no impide procesar otro de la misma tanda que sí la tiene", async () => {
    connectorFindMany.mockResolvedValue([CUENTA_A, CUENTA_B]);
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            { value: { leadgen_id: "lg-x", form_id: "form-1", page_id: "PAGE-X" } },
            { value: { leadgen_id: "lg-a", form_id: "form-1", page_id: "PAGE-A" } },
          ],
        },
      ],
    });

    const res = await postFirmado(body, "secret-A");

    expect(res.status).toBe(200);
    expect(reservarLeadEntrante).toHaveBeenCalledTimes(1);
    expect(reservarLeadEntrante.mock.calls[0][0]).toBe("conn-A");
    expect(reservarLeadEntrante.mock.calls[0][1]).toBe("lg-a");
  });
});

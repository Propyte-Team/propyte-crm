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

/** El detalle con el que queda en ERROR un lead de una página sin cuenta. */
function detallePaginaSinCuenta(pageId: string, leadgenId: string) {
  return `Página ${pageId} sin cuenta registrada en Conexiones; lead ${leadgenId} no asignado a ninguna marca`;
}

describe("webhook de Lead Ads — asignación estricta de página a cuenta", () => {
  // Seguimiento T5 (2026-10-09): antes este lead se descartaba con solo un console.warn y no
  // quedaba NI UNA fila en ConnectorLeadLog, lo que contradice el criterio de #713 (un lead pagado
  // siempre deja rastro visible). Ahora se reserva bajo la cuenta cuya firma validó y se marca en
  // ERROR con el motivo; sigue sin pedirse a Graph ni asignarse a ninguna marca.
  it("🚨 con DOS cuentas META y un page_id sin cuenta: se reserva bajo la cuenta firmante, queda en ERROR con el detalle, sin Graph, y responde 200", async () => {
    connectorFindMany.mockResolvedValue([CUENTA_A, CUENTA_B]);

    // La firma valida con la A, pero la página "PAGE-X" no es de ninguna: antes caía en la A.
    const res = await postFirmado(leadgen("PAGE-X"), "secret-A");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 1 });
    expect(reservarLeadEntrante).toHaveBeenCalledTimes(1);
    expect(reservarLeadEntrante).toHaveBeenCalledWith("conn-A", "lg-1", {
      webhook: { leadgen_id: "lg-1", form_id: "form-1", page_id: "PAGE-X" },
      motivo: "pagina_sin_cuenta",
    });
    // marcarLeadFallido deja el log en ERROR con el detalle Y escribe lastError del conector
    // (markConnectorLead va dentro): es el mismo helper que usa el resto de este archivo.
    expect(marcarLeadFallido).toHaveBeenCalledTimes(1);
    expect(marcarLeadFallido).toHaveBeenCalledWith("log-1", "conn-A", detallePaginaSinCuenta("PAGE-X", "lg-1"));
    expect(processIncomingLead).not.toHaveBeenCalled(); // no se asigna a ninguna marca
    expect(fetchMock).not.toHaveBeenCalled(); // ni siquiera se pidió el detalle a Graph
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toContain("PAGE-X");
  });

  it("la reserva va bajo la cuenta que FIRMÓ, no bajo la primera de la lista", async () => {
    connectorFindMany.mockResolvedValue([CUENTA_A, CUENTA_B]);

    const res = await postFirmado(leadgen("PAGE-X"), "secret-B");

    expect(res.status).toBe(200);
    expect(reservarLeadEntrante).toHaveBeenCalledTimes(1);
    expect(reservarLeadEntrante.mock.calls[0][0]).toBe("conn-B");
    expect(marcarLeadFallido).toHaveBeenCalledWith("log-1", "conn-B", detallePaginaSinCuenta("PAGE-X", "lg-1"));
  });

  it("un lead repetido de una página sin cuenta (yaProcesado) no se vuelve a marcar", async () => {
    connectorFindMany.mockResolvedValue([CUENTA_A, CUENTA_B]);
    reservarLeadEntrante.mockResolvedValue({ logId: "log-1", yaProcesado: true });

    const res = await postFirmado(leadgen("PAGE-X"), "secret-A");

    expect(res.status).toBe(200);
    expect(reservarLeadEntrante).toHaveBeenCalledTimes(1);
    expect(marcarLeadFallido).not.toHaveBeenCalled();
    expect(processIncomingLead).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Un lote con un huérfano y un lead que falla vuelve a entregarse completo (503). El huérfano ya
  // quedó en ERROR la primera vez: re-marcarlo sumaría otro errorCount por la misma causa.
  it("un huérfano que ya estaba en ERROR (reentrega) no se re-marca ni suma otro errorCount", async () => {
    connectorFindMany.mockResolvedValue([CUENTA_A, CUENTA_B]);
    reservarLeadEntrante.mockResolvedValue({ logId: "log-1", yaProcesado: false, estadoPrevio: "ERROR" });

    const res = await postFirmado(leadgen("PAGE-X"), "secret-A");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 1 });
    expect(reservarLeadEntrante).toHaveBeenCalledTimes(1);
    expect(marcarLeadFallido).not.toHaveBeenCalled();
    expect(processIncomingLead).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("una reserva que quedó a medias (RECEIVED) sí se marca en ERROR al reentregarse", async () => {
    connectorFindMany.mockResolvedValue([CUENTA_A, CUENTA_B]);
    reservarLeadEntrante.mockResolvedValue({ logId: "log-1", yaProcesado: false, estadoPrevio: "RECEIVED" });

    const res = await postFirmado(leadgen("PAGE-X"), "secret-A");

    expect(res.status).toBe(200);
    expect(marcarLeadFallido).toHaveBeenCalledTimes(1);
    expect(marcarLeadFallido).toHaveBeenCalledWith("log-1", "conn-A", detallePaginaSinCuenta("PAGE-X", "lg-1"));
  });

  // Si ni siquiera se pudo dejar el rastro, se cuenta como fallo para que Meta reintente (503),
  // igual que cuando la reserva falla en el camino normal.
  it("si la reserva del lead de una página sin cuenta falla, responde 503 para que Meta reintente", async () => {
    connectorFindMany.mockResolvedValue([CUENTA_A, CUENTA_B]);
    reservarLeadEntrante.mockRejectedValue(new Error("db caída"));

    const res = await postFirmado(leadgen("PAGE-X"), "secret-A");

    expect(res.status).toBe(503);
    expect(marcarLeadFallido).not.toHaveBeenCalled();
    expect(processIncomingLead).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(marcarLeadFallido).not.toHaveBeenCalled(); // con cuenta no se marca ERROR
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
    expect(marcarLeadFallido).not.toHaveBeenCalled(); // con cuenta no se marca ERROR
    expect(warn).not.toHaveBeenCalled();
  });

  // Revisión final: `undefined === undefined`. Un cambio sin `page_id` empataba con cualquier
  // cuenta cuyas credenciales no traen `pageId` (o vacías) y el lead se le asignaba a ella.
  it("🚨 con DOS cuentas, un lead SIN page_id no empata con la cuenta de credenciales vacías", async () => {
    const SIN_CREDENCIALES = { ...cuenta("conn-B", "PAGE-B", "secret-B"), credentials: null };
    connectorFindMany.mockResolvedValue([CUENTA_A, SIN_CREDENCIALES]);
    const body = JSON.stringify({ entry: [{ changes: [{ value: { leadgen_id: "lg-1", form_id: "form-1" } }] }] });

    const res = await postFirmado(body, "secret-A");

    expect(res.status).toBe(200);
    // No empata con la cuenta de credenciales vacías: queda reservado bajo la que firmó (A),
    // en ERROR, y nunca se le asigna a la B ni se pide a Graph.
    expect(reservarLeadEntrante).toHaveBeenCalledTimes(1);
    expect(reservarLeadEntrante.mock.calls[0][0]).toBe("conn-A");
    expect(reservarLeadEntrante.mock.calls[0][2]).toMatchObject({ motivo: "pagina_sin_cuenta" });
    expect(marcarLeadFallido).toHaveBeenCalledTimes(1);
    expect(marcarLeadFallido.mock.calls[0][1]).toBe("conn-A");
    expect(marcarLeadFallido.mock.calls[0][2]).toContain("lg-1");
    expect(marcarLeadFallido.mock.calls[0][2]).toContain("sin cuenta registrada en Conexiones");
    expect(processIncomingLead).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toContain("lg-1");
  });

  it("con UNA sola cuenta, un lead sin page_id se procesa con esa cuenta (respaldo de siempre)", async () => {
    connectorFindMany.mockResolvedValue([CUENTA_A]);
    const body = JSON.stringify({ entry: [{ changes: [{ value: { leadgen_id: "lg-1", form_id: "form-1" } }] }] });

    const res = await postFirmado(body, "secret-A");

    expect(res.status).toBe(200);
    expect(reservarLeadEntrante).toHaveBeenCalledTimes(1);
    expect(reservarLeadEntrante.mock.calls[0][0]).toBe("conn-A");
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
    // El de la página sin cuenta deja su rastro en ERROR (bajo la firmante) y el otro sigue su curso.
    expect(reservarLeadEntrante).toHaveBeenCalledTimes(2);
    expect(reservarLeadEntrante.mock.calls[0][1]).toBe("lg-x");
    expect(marcarLeadFallido).toHaveBeenCalledTimes(1);
    expect(marcarLeadFallido.mock.calls[0][2]).toContain("lg-x");
    expect(reservarLeadEntrante.mock.calls[1][0]).toBe("conn-A");
    expect(reservarLeadEntrante.mock.calls[1][1]).toBe("lg-a");
    expect(processIncomingLead).toHaveBeenCalledTimes(1);
    expect(processIncomingLead.mock.calls[0][1]).toBe("lg-a");
    expect(fetchMock).toHaveBeenCalledTimes(1); // solo el de la página que sí tiene cuenta
  });
});

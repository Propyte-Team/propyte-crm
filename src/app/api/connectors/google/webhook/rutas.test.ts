import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #739 · AUD-20260903 L-07.
//
// Google Ads tiene un botón "enviar datos de prueba" para comprobar que el webhook
// responde. El CRM no distinguía esa prueba de un prospecto real: `is_test` no existía en
// ningún lugar de src/, así que el payload de prueba entraba a processIncomingLead —el
// único camino— que crea el contacto, lo autoasigna, arranca el reloj de SLA y manda un
// evento de conversión a Meta. Probar la conexión ensuciaba la base y falseaba los números.
//
// La primera prueba de este archivo falla contra el código anterior.

const connectorFindMany = vi.fn();
const connectorUpdate = vi.fn();
const processIncomingLead = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    leadConnector: {
      findMany: (...a: unknown[]) => connectorFindMany(...a),
      update: (...a: unknown[]) => connectorUpdate(...a),
    },
  },
}));

vi.mock("@/lib/intake/connectors", () => ({
  readCredentials: (c: { credentials?: unknown }) => c.credentials,
  mapExternalFields: (_map: unknown, external: Record<string, unknown>) => ({ ...external }),
  processIncomingLead: (...a: unknown[]) => processIncomingLead(...a),
}));

import { POST } from "./route";

const LLAVE = "llave-del-conector";

function postear(payload: Record<string, unknown>) {
  return POST(
    new Request("http://t/api/connectors/google/webhook", {
      method: "POST",
      body: JSON.stringify(payload),
    }) as never
  );
}

function leadDePrueba(extra: Record<string, unknown> = {}) {
  return {
    lead_id: "lead-1",
    google_key: LLAVE,
    is_test: true,
    user_column_data: [
      { column_id: "FULL_NAME", string_value: "Prueba de Google" },
      { column_id: "PHONE_NUMBER", string_value: "+520000000000" },
    ],
    ...extra,
  };
}

beforeEach(() => {
  connectorFindMany.mockReset().mockResolvedValue([
    { id: "conn-1", fieldMap: {}, credentials: { webhookKey: LLAVE } },
  ]);
  connectorUpdate.mockReset().mockResolvedValue({});
  processIncomingLead.mockReset().mockResolvedValue({ status: "PROCESSED" });
});

describe("webhook de Google Ads — is_test (#739)", () => {
  it("un lead de prueba NO entra a la ingesta", async () => {
    const res = await postear(leadDePrueba());

    expect(res.status).toBe(200);
    // Lo único que importa: no se creó contacto, ni asignación, ni SLA, ni conversión.
    expect(processIncomingLead).not.toHaveBeenCalled();
  });

  it("pero sí deja señal de vida del conector", async () => {
    // Es lo único para lo que sirve ese botón: saber que el webhook responde. Si se
    // descartara sin dejar rastro, la prueba de Google dejaría de decir nada.
    await postear(leadDePrueba());

    expect(connectorUpdate).toHaveBeenCalledOnce();
    const args = connectorUpdate.mock.calls[0][0];
    expect(args.where).toEqual({ id: "conn-1" });
    expect(args.data.lastSyncAt).toBeInstanceOf(Date);
    // `lastLeadAt` no se toca: no llegó ningún prospecto. El panel distingue las dos cosas.
    expect(args.data.lastLeadAt).toBeUndefined();
  });

  it("is_test: false y is_test ausente sí son leads reales", async () => {
    await postear(leadDePrueba({ is_test: false }));
    expect(processIncomingLead).toHaveBeenCalledOnce();

    processIncomingLead.mockClear();
    const { is_test: _omitido, ...sinCampo } = leadDePrueba();
    await postear(sinCampo);
    expect(processIncomingLead).toHaveBeenCalledOnce();
  });

  it("una llave que no corresponde es 401, y ni se mira el is_test", async () => {
    const res = await postear(leadDePrueba({ google_key: "otra-llave" }));

    expect(res.status).toBe(401);
    expect(connectorUpdate).not.toHaveBeenCalled();
    expect(processIncomingLead).not.toHaveBeenCalled();
  });

  it("la llave se compara en tiempo constante: un prefijo correcto no basta (#736)", async () => {
    const res = await postear(leadDePrueba({ google_key: LLAVE.slice(0, 5) }));

    expect(res.status).toBe(401);
  });
});

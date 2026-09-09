import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #713 · AUD-20260903 L-01.
//
// Un lead de Facebook que fallaba al procesarse se perdía para siempre: el webhook pedía
// el detalle a Graph ANTES de registrar nada, así que si el token de Página había caducado
// no quedaba ni una fila —ni el id, ni el payload, ni rastro—; encima se respondía 200, de
// modo que Meta lo daba por entregado y no reintentaba. Y la fila que sí llegaba a
// crearse, si terminaba en ERROR, bloqueaba para siempre cualquier reintento con su propia
// marca de idempotencia.

const logCreate = vi.fn();
const logFindUnique = vi.fn();
const logFindMany = vi.fn();
const logUpdate = vi.fn();
const connectorFindUnique = vi.fn();
const connectorUpdate = vi.fn();
const captureLead = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    connectorLeadLog: {
      create: (...a: unknown[]) => logCreate(...a),
      findUnique: (...a: unknown[]) => logFindUnique(...a),
      findMany: (...a: unknown[]) => logFindMany(...a),
      update: (...a: unknown[]) => logUpdate(...a),
    },
    leadConnector: {
      findUnique: (...a: unknown[]) => connectorFindUnique(...a),
      update: (...a: unknown[]) => connectorUpdate(...a),
    },
  },
}));

vi.mock("./capture-lead", () => ({ captureLead: (...a: unknown[]) => captureLead(...a) }));

import {
  reservarLeadEntrante,
  processIncomingLead,
  reprocesarLeadsFallidos,
  CAMPOS_MAPEADOS,
} from "./connectors";

/** El error de clave duplicada tal como lo lanza Prisma. */
const duplicado = Object.assign(new Error("Unique constraint"), { code: "P2002" });

beforeEach(() => {
  for (const m of [logCreate, logFindUnique, logFindMany, logUpdate, connectorFindUnique, connectorUpdate, captureLead]) {
    m.mockReset();
  }
  logCreate.mockResolvedValue({ id: "log-1" });
  logUpdate.mockResolvedValue({});
  connectorFindUnique.mockResolvedValue({ id: "conn-1", provider: "META", config: {} });
  connectorUpdate.mockResolvedValue({});
  captureLead.mockResolvedValue({ contactId: "c1", isNew: true });
  logFindMany.mockResolvedValue([]);
});

describe("reservarLeadEntrante (#713)", () => {
  it("registra el lead antes de que nada pueda fallar", async () => {
    const r = await reservarLeadEntrante("conn-1", "lead-1", { webhook: { form_id: "f1" } });

    expect(r).toEqual({ logId: "log-1", yaProcesado: false });
    // Y con el payload crudo dentro: es lo que permite reprocesarlo o al menos verlo.
    expect(logCreate.mock.calls[0][0].data).toMatchObject({
      connectorId: "conn-1",
      externalLeadId: "lead-1",
      status: "RECEIVED",
      rawPayload: { webhook: { form_id: "f1" } },
    });
  });

  it("un lead ya procesado no se vuelve a tocar", async () => {
    logCreate.mockRejectedValue(duplicado);
    logFindUnique.mockResolvedValue({ id: "log-1", status: "PROCESSED" });

    expect(await reservarLeadEntrante("conn-1", "lead-1", {})).toEqual({
      logId: "log-1",
      yaProcesado: true,
    });
  });

  it("un lead que quedó en ERROR SÍ se puede reintentar", async () => {
    // Este es el corazón del bug: la marca de idempotencia, que existe para evitar
    // duplicados, estaba bloqueando el reintento de algo que nunca llegó a entrar.
    logCreate.mockRejectedValue(duplicado);
    logFindUnique.mockResolvedValue({ id: "log-1", status: "ERROR" });

    expect(await reservarLeadEntrante("conn-1", "lead-1", {})).toEqual({
      logId: "log-1",
      yaProcesado: false,
    });
  });

  it("una reserva a medias tampoco bloquea", async () => {
    logCreate.mockRejectedValue(duplicado);
    logFindUnique.mockResolvedValue({ id: "log-1", status: "RECEIVED" });

    expect((await reservarLeadEntrante("conn-1", "lead-1", {})).yaProcesado).toBe(false);
  });

  it("un duplicado marcado como tal se respeta", async () => {
    logCreate.mockRejectedValue(duplicado);
    logFindUnique.mockResolvedValue({ id: "log-1", status: "DUPLICATE" });

    expect((await reservarLeadEntrante("conn-1", "lead-1", {})).yaProcesado).toBe(true);
  });

  it("un error que no es de clave duplicada sube", async () => {
    logCreate.mockRejectedValue(new Error("la base no responde"));

    await expect(reservarLeadEntrante("conn-1", "lead-1", {})).rejects.toThrow("la base no responde");
  });
});

describe("processIncomingLead guarda con qué reprocesar (#713)", () => {
  it("deja los campos ya mapeados junto al payload crudo", async () => {
    await processIncomingLead("conn-1", "lead-1", { external: { email: "a@b.c" } }, {
      email: "a@b.c",
      firstName: "Ana",
    });

    const guardado = logUpdate.mock.calls[0][0].data;
    expect(guardado.status).toBe("PROCESSED");
    expect(guardado.rawPayload[CAMPOS_MAPEADOS]).toMatchObject({ email: "a@b.c", firstName: "Ana" });
    // El crudo original sigue ahí: no se sustituye, se acompaña.
    expect(guardado.rawPayload.external).toEqual({ email: "a@b.c" });
  });
});

describe("reprocesarLeadsFallidos (#713)", () => {
  it("reintenta los fallidos que guardaron sus campos mapeados", async () => {
    logFindMany.mockResolvedValue([
      {
        connectorId: "conn-1",
        externalLeadId: "lead-1",
        rawPayload: { external: { email: "a@b.c" }, [CAMPOS_MAPEADOS]: { email: "a@b.c" } },
      },
    ]);
    logCreate.mockRejectedValue(duplicado);
    logFindUnique.mockResolvedValue({ id: "log-1", status: "ERROR" });

    const r = await reprocesarLeadsFallidos();

    expect(r).toEqual({ intentados: 1, recuperados: 1 });
    expect(captureLead).toHaveBeenCalledOnce();
  });

  it("salta los que no se pueden rehacer sin volver al proveedor", async () => {
    // El lead que falló ANTES del mapeo (token caducado) no tiene con qué reprocesarse:
    // esa recuperación es la del 5xx, que hace que Meta reintente. Aquí solo se salta,
    // y la fila se queda visible en ERROR en vez de desaparecer.
    logFindMany.mockResolvedValue([
      { connectorId: "conn-1", externalLeadId: "lead-2", rawPayload: { webhook: { leadgen_id: "lead-2" } } },
    ]);

    const r = await reprocesarLeadsFallidos();

    expect(r).toEqual({ intentados: 0, recuperados: 0 });
    expect(captureLead).not.toHaveBeenCalled();
  });

  it("solo mira los que quedaron en ERROR sin contacto", async () => {
    await reprocesarLeadsFallidos(10);

    expect(logFindMany.mock.calls[0][0]).toMatchObject({
      where: { status: "ERROR", contactId: null },
      take: 10,
    });
  });

  it("un lead que revienta al reprocesar no corta la tanda", async () => {
    logFindMany.mockResolvedValue([
      { connectorId: "conn-1", externalLeadId: "lead-1", rawPayload: { [CAMPOS_MAPEADOS]: { email: "a@b.c" } } },
      { connectorId: "conn-1", externalLeadId: "lead-2", rawPayload: { [CAMPOS_MAPEADOS]: { email: "d@e.f" } } },
    ]);
    logCreate.mockRejectedValue(duplicado);
    logFindUnique.mockResolvedValue({ id: "log-1", status: "ERROR" });
    captureLead.mockRejectedValueOnce(new Error("sigue sin responder"));
    captureLead.mockResolvedValueOnce({ contactId: "c2", isNew: true });

    const r = await reprocesarLeadsFallidos();

    expect(r.intentados).toBe(2);
    expect(r.recuperados).toBe(1);
  });
});

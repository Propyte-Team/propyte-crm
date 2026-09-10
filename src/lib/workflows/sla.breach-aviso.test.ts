import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #756, el cableado: que `checkSlaBreaches` de verdad cree la notificación, al
// destinatario que decide `escalacion.ts`, y que un fallo del aviso NO tumbe el barrido.
//
// Todas las pruebas de este archivo fallan contra origin/main, donde no se crea ninguna
// notificación en ningún vencimiento.

const timerFindMany = vi.fn();
const timerUpdate = vi.fn();
const timerFindFirst = vi.fn();
const timerCreate = vi.fn();
const contactFindUnique = vi.fn();
const userFindMany = vi.fn();
const policyFindMany = vi.fn();
const notificationCreate = vi.fn();
const notificationCreateMany = vi.fn();
const emitEvent = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    slaTimer: {
      findMany: (...a: unknown[]) => timerFindMany(...a),
      update: (...a: unknown[]) => timerUpdate(...a),
      findFirst: (...a: unknown[]) => timerFindFirst(...a),
      create: (...a: unknown[]) => timerCreate(...a),
    },
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    slaPolicy: { findMany: (...a: unknown[]) => policyFindMany(...a) },
    notification: {
      create: (...a: unknown[]) => notificationCreate(...a),
      createMany: (...a: unknown[]) => notificationCreateMany(...a),
    },
  },
}));
vi.mock("./events", () => ({ emitEvent: (...a: unknown[]) => emitEvent(...a) }));

import { checkSlaBreaches } from "./sla";

const VENCIDO = new Date("2026-09-10T12:00:00.000Z");

function timer(over: Record<string, unknown> = {}) {
  return { id: "t1", contactId: "c1", type: "FIRST_TOUCH", dueAt: VENCIDO, dealId: null, ...over };
}

/** El contacto tal como lo pide `avisarDelVencimiento`. */
function contacto(asignado: Record<string, unknown> | null, over: Record<string, unknown> = {}) {
  return {
    firstName: "Ana",
    lastName: "Pérez",
    leadSource: "MESSENGER",
    targetPlaza: "TULUM",
    assignedToId: asignado ? (asignado.id as string) : null,
    assignedTo: asignado,
    ...over,
  };
}

const ASESOR_REAL = { id: "ase-1", email: "sonia@nativatulum.mx", teamLeaderId: null, plaza: "TULUM" };

beforeEach(() => {
  vi.clearAllMocks();
  timerUpdate.mockResolvedValue({});
  timerFindFirst.mockResolvedValue(null);
  timerCreate.mockResolvedValue({});
  policyFindMany.mockResolvedValue([]);
  notificationCreate.mockResolvedValue({});
  notificationCreateMany.mockResolvedValue({ count: 1 });
  userFindMany.mockResolvedValue([]);
  emitEvent.mockResolvedValue(undefined);
});

describe("checkSlaBreaches — el vencimiento AVISA (#756)", () => {
  it("FIRST_TOUCH sobre un asesor real le crea su notificación", async () => {
    timerFindMany.mockResolvedValue([timer()]);
    contactFindUnique.mockResolvedValue(contacto(ASESOR_REAL));

    await checkSlaBreaches();

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    const { data } = notificationCreate.mock.calls[0][0];
    expect(data.userId).toBe("ase-1");
    expect(data.type).toBe("sla_breach");
    expect(data.link).toBe("/contacts/c1");
    expect(data.message).toContain("Ana Pérez");
  });

  it("RETRY escala al líder de equipo y NO al asesor", async () => {
    timerFindMany.mockResolvedValue([timer({ type: "RETRY" })]);
    contactFindUnique.mockResolvedValue(contacto({ ...ASESOR_REAL, teamLeaderId: "tl-1" }));

    await checkSlaBreaches();

    expect(notificationCreateMany).toHaveBeenCalledTimes(1);
    const filas = notificationCreateMany.mock.calls[0][0].data;
    expect(filas).toHaveLength(1);
    expect(filas[0].userId).toBe("tl-1");
    expect(notificationCreate).not.toHaveBeenCalled();
    // Y no se buscó mando por plaza: con líder de equipo no hace falta la consulta.
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it("RETRY sin líder escala a la gerencia de la plaza DEL ASESOR", async () => {
    timerFindMany.mockResolvedValue([timer({ type: "RETRY" })]);
    // La plaza del contacto y la del asesor difieren a propósito: se escala a quien manda
    // sobre la PERSONA, no a quien manda sobre el lead.
    contactFindUnique.mockResolvedValue(
      contacto({ ...ASESOR_REAL, plaza: "PDC" }, { targetPlaza: "TULUM" })
    );
    userFindMany.mockResolvedValue([{ id: "ger-pdc" }]);

    await checkSlaBreaches();

    expect(userFindMany.mock.calls[0][0].where.plaza).toBe("PDC");
    expect(notificationCreateMany.mock.calls[0][0].data[0].userId).toBe("ger-pdc");
  });

  it("sin gerencia en esa plaza, cae a toda la gerencia", async () => {
    timerFindMany.mockResolvedValue([timer({ type: "RETRY" })]);
    contactFindUnique.mockResolvedValue(contacto(ASESOR_REAL));
    userFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "dir" }]);

    await checkSlaBreaches();

    expect(userFindMany).toHaveBeenCalledTimes(2);
    // La segunda consulta va sin plaza: es la caída deliberada.
    expect(userFindMany.mock.calls[1][0].where.plaza).toBeUndefined();
    expect(notificationCreateMany.mock.calls[0][0].data[0].userId).toBe("dir");
  });
});

describe("checkSlaBreaches — a quién NO se le avisa (#756 + #734)", () => {
  it("una cuenta del dominio técnico no genera NINGUNA notificación", async () => {
    // 166 de los 168 vencimientos de la historia son de esta cuenta. Sin este filtro, el
    // día del despliegue la gerencia recibe un centenar de avisos de un buzón que nadie abre.
    timerFindMany.mockResolvedValue([timer({ type: "RETRY" })]);
    contactFindUnique.mockResolvedValue(
      contacto({ id: "agentes", email: "agentes@propyte.local", teamLeaderId: null, plaza: "TULUM" })
    );
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => {});

    await checkSlaBreaches();

    expect(notificationCreate).not.toHaveBeenCalled();
    expect(notificationCreateMany).not.toHaveBeenCalled();
    // Pero SÍ queda rastro con el motivo: un aviso que no se manda y no se explica es
    // indistinguible de uno que se perdió.
    expect(avisos).toHaveBeenCalledWith(expect.stringContaining("dominio técnico"));

    avisos.mockRestore();
  });

  it("un contacto sin dueño tampoco", async () => {
    timerFindMany.mockResolvedValue([timer()]);
    contactFindUnique.mockResolvedValue(contacto(null));
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => {});

    await checkSlaBreaches();

    expect(notificationCreate).not.toHaveBeenCalled();
    expect(notificationCreateMany).not.toHaveBeenCalled();

    avisos.mockRestore();
  });

  it("un ORPHAN no avisa: sendToPond ya avisó al sellarlo", async () => {
    timerFindMany.mockResolvedValue([timer({ type: "ORPHAN" })]);
    contactFindUnique.mockResolvedValue(contacto(null));
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => {});

    await checkSlaBreaches();

    expect(notificationCreate).not.toHaveBeenCalled();
    expect(notificationCreateMany).not.toHaveBeenCalled();

    avisos.mockRestore();
  });
});

describe("checkSlaBreaches — el aviso no manda sobre el barrido (#756)", () => {
  it("si el aviso truena, el reloj SÍ se marca y el evento SÍ se emite", async () => {
    // La dirección del fallo, deliberada: perder un aviso es malo; dejar de marcar
    // vencimientos es perder el indicador entero.
    timerFindMany.mockResolvedValue([timer()]);
    contactFindUnique.mockResolvedValue(contacto(ASESOR_REAL));
    notificationCreate.mockRejectedValue(new Error("tabla caída"));
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});

    const n = await checkSlaBreaches();

    expect(n).toBe(1);
    expect(timerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t1" }, data: expect.objectContaining({ status: "BREACHED" }) })
    );
    expect(emitEvent).toHaveBeenCalledWith("sla.breach", "contact", "c1", expect.anything());
    // Y no en silencio: la lección de la #687.
    expect(errores).toHaveBeenCalled();

    errores.mockRestore();
  });

  it("si el contacto ya no existe, no truena y el barrido sigue", async () => {
    timerFindMany.mockResolvedValue([timer(), timer({ id: "t2", contactId: "c2" })]);
    contactFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(contacto(ASESOR_REAL));

    const n = await checkSlaBreaches();

    expect(n).toBe(2);
    expect(timerUpdate).toHaveBeenCalledTimes(2);
    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });

  it("se marca ANTES de avisar, no después", async () => {
    // Si se avisara primero y el marcado fallara, el mismo reloj volvería a verse en el
    // siguiente barrido —sigue RUNNING— y avisaría otra vez, cada minuto.
    timerFindMany.mockResolvedValue([timer()]);
    contactFindUnique.mockResolvedValue(contacto(ASESOR_REAL));
    const orden: string[] = [];
    timerUpdate.mockImplementation(async () => { orden.push("marcar"); return {}; });
    notificationCreate.mockImplementation(async () => { orden.push("avisar"); return {}; });

    await checkSlaBreaches();

    expect(orden).toEqual(["marcar", "avisar"]);
  });

  it("el barrido solo mira los RUNNING, que es toda la idempotencia que hace falta", async () => {
    // Un reloj ya BREACHED no vuelve a entrar, así que no puede re-avisar por más veces que
    // corra el cron. Si algún día algo devuelve un timer a RUNNING, esta prueba avisa antes
    // que el usuario.
    timerFindMany.mockResolvedValue([]);

    await checkSlaBreaches();

    expect(timerFindMany.mock.calls[0][0].where.status).toBe("RUNNING");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const processPendingEvents = vi.fn();
const runQueue = vi.fn();
const recuperarEncalladas = vi.fn();
const checkSlaBreaches = vi.fn();
const runEnrollments = vi.fn();
const runInactivityRules = vi.fn();
const emitEvent = vi.fn();
const paymentFindMany = vi.fn();
const paymentUpdate = vi.fn();
/** Ejecuta el callback de `$transaction` con un `tx` mínimo. */
const transaction = vi.fn(
  async (fn: (tx: unknown) => unknown, tx: unknown) => await fn(tx),
);

vi.mock("@/lib/db", () => ({
  default: {
    paymentSchedule: {
      findMany: (...a: unknown[]) => paymentFindMany(...a),
      update: (...a: unknown[]) => paymentUpdate(...a),
    },
    // El estado y el evento de una parcialidad vencida van juntos desde la auditoría
    // 2026-09-10: si `emitEvent` fallaba, la parcialidad quedaba VENCIDA y el aviso no
    // salía nunca. El doble ejecuta el callback como lo haría Postgres.
    $transaction: (fn: (tx: unknown) => unknown) =>
      transaction(fn, { paymentSchedule: { update: (...a: unknown[]) => paymentUpdate(...a) } }),
  },
}));
vi.mock("@/lib/workflows/events", () => ({
  processPendingEvents: (...a: unknown[]) => processPendingEvents(...a),
  emitEvent: (...a: unknown[]) => emitEvent(...a),
}));
vi.mock("@/lib/workflows/queue", () => ({
  runQueue: (...a: unknown[]) => runQueue(...a),
  // Etapa añadida en la auditoría 2026-09-10: rescata las acciones que se quedaron en
  // RUNNING cuando el proceso murió a mitad de un envío. Ver lib/workflows/queue.ts.
  recuperarEncalladas: (...a: unknown[]) => recuperarEncalladas(...a),
}));
vi.mock("@/lib/workflows/sla", () => ({ checkSlaBreaches: (...a: unknown[]) => checkSlaBreaches(...a) }));
vi.mock("@/lib/workflows/scheduler", () => ({
  runEnrollments: (...a: unknown[]) => runEnrollments(...a),
  runInactivityRules: (...a: unknown[]) => runInactivityRules(...a),
}));

import { GET } from "./route";

const SECRET = "secreto_de_prueba";

function pedir(headers: Record<string, string> = {}, query = "") {
  return {
    headers: { get: (h: string) => headers[h] ?? null },
    nextUrl: new URL(`http://t/api/cron/workflows${query}`),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  processPendingEvents.mockResolvedValue({ procesados: 3 });
  runQueue.mockResolvedValue({ corridas: 2 });
  recuperarEncalladas.mockResolvedValue({ reencoladas: 0, agotadas: 0 });
  checkSlaBreaches.mockResolvedValue({ marcados: 1 });
  runEnrollments.mockResolvedValue({ inscritos: 0 });
  runInactivityRules.mockResolvedValue({ disparadas: 0 });
  paymentFindMany.mockResolvedValue([]);
  paymentUpdate.mockResolvedValue({});
});

/** Una parcialidad vencida tal como la selecciona `checkOverduePayments`. */
function parcialidad(id: string) {
  return {
    id,
    number: 1,
    amount: "1000",
    dueDate: new Date("2026-01-01"),
    plan: { quote: { dealId: `deal-${id}` } },
  };
}

afterEach(() => {
  delete process.env.CRON_SECRET;
});

/**
 * #664 — el tick corría sus siete etapas bajo UN solo try/catch.
 *
 * Si la primera tropezaba, las seis siguientes no llegaban a correr: entre ellas la que
 * marca fuera de tiempo las respuestas a prospectos nuevos y la que dispara los seguimientos
 * programados. El sistema no se cae ni avisa — simplemente deja de pasar el tiempo para todo
 * lo que depende del reloj, y desde fuera se ve igual que un día tranquilo.
 */
describe("GET /api/cron/workflows — aislamiento por etapa", () => {
  it("con todo en orden corre todas las etapas y responde ok", async () => {
    const r = await GET(pedir({ "x-cron-secret": SECRET }));
    const body = await r.json();

    expect(r.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body).toMatchObject({
      events: { procesados: 3 },
      encalladas: { reencoladas: 0, agotadas: 0 },
      queue: { corridas: 2 },
      slaBreaches: { marcados: 1 },
    });
    expect(typeof body.ms).toBe("number");
  });

  it("el rescate de encalladas corre ANTES de la cola, para que entren en la misma pasada", async () => {
    const orden: string[] = [];
    recuperarEncalladas.mockImplementation(async () => {
      orden.push("encalladas");
      return { reencoladas: 1, agotadas: 0 };
    });
    runQueue.mockImplementation(async () => {
      orden.push("queue");
      return { corridas: 2 };
    });

    await GET(pedir({ "x-cron-secret": SECRET }));

    expect(orden).toEqual(["encalladas", "queue"]);
  });

  /**
   * 🚨 El caso del hallazgo: revienta la PRIMERA etapa. Antes eso cancelaba las seis
   * siguientes; ahora todas corren igual.
   */
  it("si la primera etapa revienta, las seis siguientes SÍ corren", async () => {
    processPendingEvents.mockRejectedValue(new Error("boom en eventos"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await GET(pedir({ "x-cron-secret": SECRET }));
    const body = await r.json();

    // Las que importan para que el tiempo siga pasando:
    expect(checkSlaBreaches).toHaveBeenCalled();
    expect(runEnrollments).toHaveBeenCalled();
    expect(runInactivityRules).toHaveBeenCalled();
    expect(runQueue).toHaveBeenCalled();
    // Y su trabajo aparece en la respuesta, no se pierde.
    expect(body.slaBreaches).toEqual({ marcados: 1 });
    err.mockRestore();
  });

  it("el fallo se reporta con el NOMBRE de la etapa que lo produjo", async () => {
    checkSlaBreaches.mockRejectedValue(new Error("la base dijo que no"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const body = await (await GET(pedir({ "x-cron-secret": SECRET }))).json();

    expect(body.fallos).toHaveLength(1);
    expect(body.fallos[0].etapa).toBe("slaBreaches");
    expect(body.fallos[0].error).toMatch(/la base dijo que no/);
    err.mockRestore();
  });

  /**
   * Un 200 con los fallos escondidos en el cuerpo sería peor que el bug original: este
   * endpoint corre cada minuto sin que nadie lea su respuesta, y cualquier monitor externo
   * mira el status.
   */
  it("con una etapa caída responde 500, aunque las otras seis hayan ido bien", async () => {
    runEnrollments.mockRejectedValue(new Error("boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await GET(pedir({ "x-cron-secret": SECRET }));
    const body = await r.json();

    expect(r.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.events).toEqual({ procesados: 3 }); // lo que sí corrió viaja igual
    err.mockRestore();
  });

  it("varias etapas caídas se reportan todas, no solo la primera", async () => {
    processPendingEvents.mockRejectedValue(new Error("uno"));
    runInactivityRules.mockRejectedValue(new Error("dos"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const body = await (await GET(pedir({ "x-cron-secret": SECRET }))).json();

    expect(body.fallos.map((f: { etapa: string }) => f.etapa)).toEqual(["events", "inactivity"]);
    err.mockRestore();
  });

  // Control: la guardia de autorización no se toca.
  it("sin el secreto sigue siendo 401 y no corre nada", async () => {
    const r = await GET(pedir({}));

    expect(r.status).toBe(401);
    expect(processPendingEvents).not.toHaveBeenCalled();
  });
});

// Auditoría 2026-09-10: `checkOverduePayments` envolvía TODO su cuerpo en un
// `catch { return 0 }`. Un fallo real —una restricción violada, la conexión caída a mitad
// del lote— se veía desde fuera igual que «hoy no había parcialidades vencidas»: la etapa
// reportaba 0 y el tick salía 200. Justo el fallo silencioso que la etapa existe para
// evitar.
describe("GET /api/cron/workflows — parcialidades vencidas", () => {
  it("marca cada parcialidad y emite su evento", async () => {
    paymentFindMany.mockResolvedValue([parcialidad("p1"), parcialidad("p2")]);

    const body = await (await GET(pedir({ "x-cron-secret": SECRET }))).json();

    expect(body.overduePayments).toBe(2);
    expect(paymentUpdate).toHaveBeenCalledTimes(2);
    expect(emitEvent).toHaveBeenCalledWith(
      "payment.overdue",
      "deal",
      "deal-p1",
      expect.objectContaining({ scheduleId: "p1" }),
    );
  });

  it("el estado y el evento van en la MISMA transacción", async () => {
    paymentFindMany.mockResolvedValue([parcialidad("p1")]);

    await GET(pedir({ "x-cron-secret": SECRET }));

    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("una parcialidad que falla no impide las demás, y sólo cuenta las que sí se marcaron", async () => {
    paymentFindMany.mockResolvedValue([parcialidad("p1"), parcialidad("p2"), parcialidad("p3")]);
    emitEvent.mockRejectedValueOnce(new Error("el motor de eventos falló"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await GET(pedir({ "x-cron-secret": SECRET }));
    const body = await r.json();

    // Dos de tres. Antes devolvía `overdue.length` (3) aunque el lote entero fallara.
    expect(body.overduePayments).toBe(2);
    // Y la etapa no tumba el tick: el fallo es de una fila, no de la etapa.
    expect(r.status).toBe(200);
    err.mockRestore();
  });

  it("🚨 un error real de la base ya NO se disfraza de «no había vencidas»", async () => {
    paymentFindMany.mockRejectedValue(new Error("connection refused"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await GET(pedir({ "x-cron-secret": SECRET }));
    const body = await r.json();

    expect(r.status).toBe(500);
    expect(body.fallos.map((f: { etapa: string }) => f.etapa)).toContain("overduePayments");
    err.mockRestore();
  });

  it("pero la tabla sin migrar (P2021) sigue perdonándose con 0", async () => {
    // Es la ÚNICA condición que el `try` original venía a cubrir.
    paymentFindMany.mockRejectedValue(Object.assign(new Error("no existe"), { code: "P2021" }));

    const r = await GET(pedir({ "x-cron-secret": SECRET }));
    const body = await r.json();

    expect(r.status).toBe(200);
    expect(body.overduePayments).toBe(0);
  });
});

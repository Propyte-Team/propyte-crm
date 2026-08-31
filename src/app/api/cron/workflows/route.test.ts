import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const processPendingEvents = vi.fn();
const runQueue = vi.fn();
const checkSlaBreaches = vi.fn();
const runEnrollments = vi.fn();
const runInactivityRules = vi.fn();
const emitEvent = vi.fn();
const paymentFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    paymentSchedule: {
      findMany: (...a: unknown[]) => paymentFindMany(...a),
      update: vi.fn(async () => ({})),
    },
  },
}));
vi.mock("@/lib/workflows/events", () => ({
  processPendingEvents: (...a: unknown[]) => processPendingEvents(...a),
  emitEvent: (...a: unknown[]) => emitEvent(...a),
}));
vi.mock("@/lib/workflows/queue", () => ({ runQueue: (...a: unknown[]) => runQueue(...a) }));
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
  checkSlaBreaches.mockResolvedValue({ marcados: 1 });
  runEnrollments.mockResolvedValue({ inscritos: 0 });
  runInactivityRules.mockResolvedValue({ disparadas: 0 });
  paymentFindMany.mockResolvedValue([]);
});

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
  it("con todo en orden corre las siete y responde ok", async () => {
    const r = await GET(pedir({ "x-cron-secret": SECRET }));
    const body = await r.json();

    expect(r.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body).toMatchObject({
      events: { procesados: 3 },
      queue: { corridas: 2 },
      slaBreaches: { marcados: 1 },
    });
    expect(typeof body.ms).toBe("number");
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

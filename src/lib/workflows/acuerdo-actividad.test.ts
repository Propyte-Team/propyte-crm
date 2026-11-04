import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ default: {} }));
const gerenciaDeLaPlaza = vi.fn();
vi.mock("./gerencia", () => ({ gerenciaDeLaPlaza: (...a: unknown[]) => gerenciaDeLaPlaza(...a) }));

import {
  evaluarAcuerdo,
  resolverMinimos,
  textoIncumplimiento,
  ventanasDeRevision,
  revisarAcuerdoDeActividad,
} from "./acuerdo-actividad";

const MIN = { minDailyCalls: 20, minDailyWhatsapps: 30, minWeeklyVisits: 5, minDailyFollowUps: 10 };
const conteo = (o: Partial<Parameters<typeof evaluarAcuerdo>[0]["conteos"][number]> = {}) => ({
  userId: "u1",
  nombre: "Ana",
  llamadas: 20,
  whatsapps: 30,
  seguimientos: 10,
  visitas: null,
  ...o,
});

describe("evaluarAcuerdo", () => {
  it("sin incumplimientos devuelve lista vacía", () => {
    expect(evaluarAcuerdo({ minimos: MIN, conteos: [conteo({ visitas: 5 })] })).toEqual([]);
  });
  it("lista cada métrica faltante con lo logrado y el mínimo", () => {
    const r = evaluarAcuerdo({ minimos: MIN, conteos: [conteo({ llamadas: 12, whatsapps: 5 })] });
    expect(r).toHaveLength(1);
    expect(r[0].faltantes.map((f) => [f.metrica, f.logrado, f.minimo])).toEqual([
      ["llamadas", 12, 20],
      ["whatsapps", 5, 30],
    ]);
    expect(textoIncumplimiento(r[0], "ayer")).toBe("Ana: ayer 12 de 20 llamadas, 5 de 30 WhatsApps");
  });
  it("las visitas solo se evalúan si hay conteo semanal", () => {
    expect(evaluarAcuerdo({ minimos: MIN, conteos: [conteo({ visitas: null })] })).toEqual([]);
    const r = evaluarAcuerdo({ minimos: MIN, conteos: [conteo({ visitas: 2 })] });
    expect(textoIncumplimiento(r[0], "ayer")).toBe("Ana: la semana pasada 2 de 5 visitas");
  });
  it("un mínimo en 0 desactiva la métrica", () => {
    expect(
      evaluarAcuerdo({ minimos: { ...MIN, minDailyCalls: 0 }, conteos: [conteo({ llamadas: 0 })] })
    ).toEqual([]);
  });
  it("resolverMinimos usa defaults cuando falta o no es número", () => {
    expect(resolverMinimos(undefined).minDailyCalls).toBe(20);
    expect(resolverMinimos({ minDailyCalls: 7, minDailyWhatsapps: "x" })).toMatchObject({
      minDailyCalls: 7,
      minDailyWhatsapps: 30,
    });
  });
});

describe("ventanasDeRevision", () => {
  it("miércoles 10:00 local: ayer = martes, sin semana", () => {
    const v = ventanasDeRevision(new Date("2026-11-04T15:00:00Z"))!;
    expect(v.ayer.desde.toISOString()).toBe("2026-11-03T05:00:00.000Z");
    expect(v.ayer.hasta.toISOString()).toBe("2026-11-04T05:00:00.000Z");
    expect(v.semana).toBeNull();
  });
  it("lunes: ayer laboral = viernes y semana = lunes a lunes anterior", () => {
    const v = ventanasDeRevision(new Date("2026-11-09T15:00:00Z"))!;
    expect(v.ayer.desde.toISOString()).toBe("2026-11-06T05:00:00.000Z");
    expect(v.semana!.desde.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(v.semana!.hasta.toISOString()).toBe("2026-11-09T05:00:00.000Z");
  });
  it("no corre en fin de semana ni antes de las 8:00 locales", () => {
    expect(ventanasDeRevision(new Date("2026-11-07T15:00:00Z"))).toBeNull();
    expect(ventanasDeRevision(new Date("2026-11-04T12:00:00Z"))).toBeNull(); // 07:00 local
  });
});

describe("revisarAcuerdoDeActividad", () => {
  const systemConfigFindMany = vi.fn();
  const systemConfigUpsert = vi.fn();
  const userFindMany = vi.fn();
  const groupBy = vi.fn();
  const messageGroupBy = vi.fn();
  const createMany = vi.fn();
  const db = {
    systemConfig: { findMany: systemConfigFindMany, upsert: systemConfigUpsert },
    user: { findMany: userFindMany },
    activity: { groupBy },
    message: { groupBy: messageGroupBy },
    notification: { createMany },
  } as never;
  const AHORA = new Date("2026-11-04T15:00:00Z");

  beforeEach(() => {
    vi.clearAllMocks();
    systemConfigFindMany.mockResolvedValue([]);
    groupBy.mockResolvedValue([]);
    messageGroupBy.mockResolvedValue([]);
    gerenciaDeLaPlaza.mockResolvedValue(["g1"]);
    userFindMany.mockResolvedValue([
      { id: "a1", name: "Ana", email: "ana@propyte.com", plaza: "CANCUN", teamLeaderId: "l1" },
      { id: "a2", name: "Beto", email: "beto@propyte.com", plaza: "CANCUN", teamLeaderId: null },
      { id: "a3", name: "QA", email: "qa@propyte.local", plaza: "CANCUN", teamLeaderId: "l1" },
    ]);
  });

  it("notifica al líder, o a la gerencia si no hay líder, y no avisa de cuentas .local", async () => {
    const r = await revisarAcuerdoDeActividad(db, AHORA);
    expect(r).toMatchObject({ asesores: 2, incumplidos: 2, notificaciones: 2 });
    const data = createMany.mock.calls[0][0].data;
    expect(data.map((d: { userId: string }) => d.userId).sort()).toEqual(["g1", "l1"]);
    expect(data[0].type).toBe("activity_below_minimum");
    expect(data[0].message).toContain("ayer 0 de 20 llamadas");
    expect(gerenciaDeLaPlaza).toHaveBeenCalledWith("CANCUN");
    expect(systemConfigUpsert).toHaveBeenCalledTimes(1);
  });

  it("no repite en el mismo día", async () => {
    systemConfigFindMany.mockResolvedValue([
      { key: "activity_agreement.last_run", value: { dia: "2026-11-04" } },
    ]);
    const r = await revisarAcuerdoDeActividad(db, AHORA);
    expect(r.omitido).toBe("ya_corrio");
    expect(createMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it("sin incumplimientos no notifica", async () => {
    const filas = (n: number) => [
      { userId: "a1", _count: { _all: n } },
      { userId: "a2", _count: { _all: n } },
    ];
    groupBy.mockResolvedValue(filas(100));
    messageGroupBy.mockResolvedValue(filas(100));
    const r = await revisarAcuerdoDeActividad(db, AHORA);
    expect(r).toMatchObject({ incumplidos: 0, notificaciones: 0 });
    expect(createMany).not.toHaveBeenCalled();
  });

  it("los WhatsApps se cuentan de mensajes del asesor, no de actividades (el bot no suma)", async () => {
    groupBy.mockResolvedValue([
      { userId: "a1", _count: { _all: 100 } },
      { userId: "a2", _count: { _all: 100 } },
    ]);
    messageGroupBy.mockResolvedValue([{ userId: "a1", _count: { _all: 100 } }]);
    const r = await revisarAcuerdoDeActividad(db, AHORA);
    expect(r).toMatchObject({ incumplidos: 1 });
    const where = messageGroupBy.mock.calls[0][0].where;
    expect(where).toMatchObject({ channel: "WHATSAPP", direction: "OUTBOUND", sender: "ADVISOR" });
    expect(createMany.mock.calls[0][0].data[0].message).toContain("WhatsApps");
  });

  it("fuera de horario no consulta nada", async () => {
    const r = await revisarAcuerdoDeActividad(db, new Date("2026-11-07T15:00:00Z"));
    expect(r.omitido).toBe("fuera_de_horario");
    expect(systemConfigFindMany).not.toHaveBeenCalled();
  });
});

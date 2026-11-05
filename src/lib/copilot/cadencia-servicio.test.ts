// #988 — El servicio de la cadencia con un cliente de base doblado en memoria. Las consultas crudas
// (señales, vencidas, tablero) se probaron contra un Postgres 16 real; aquí va la lógica de qué se
// escribe y en qué orden.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  marcarResultado,
  materializarCadencias,
  terminarCadenciasVencidas,
} from "./cadencia-servicio";

type Fila = Record<string, unknown>;
const { db, cliente } = vi.hoisted(() => {
  const db = {
    cadencias: [] as Fila[],
    toques: [] as Fila[],
    contactos: [] as Fila[],
    fuentes: [] as string[],
    orden: [] as string[],
  };

  function coincide(f: Fila, where: Fila = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const o = v as { in?: unknown[]; notIn?: unknown[]; lte?: Date };
        if (o.in) return o.in.includes(f[k]);
        if (o.lte) return new Date(f[k] as string) <= o.lte;
      }
      return f[k] === v;
    });
  }

  const cliente = {
    $executeRaw: vi.fn(async (_s: TemplateStringsArray, fuente: string) => {
      db.fuentes.push(fuente);
      return 1;
    }),
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (x: unknown) =>
      typeof x === "function"
        ? (x as (tx: unknown) => unknown)(cliente)
        : Promise.all(x as unknown[]),
    ),
    copilotCadencia: {
      findUnique: vi.fn(
        async ({ where }: { where: Fila }) =>
          db.cadencias.find((k) => coincide(k, where)) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where?: Fila } = {}) =>
        db.cadencias.filter((k) => coincide(k, where)),
      ),
      update: vi.fn(async ({ where, data }: { where: Fila; data: Fila }) => {
        db.orden.push(`cadencia:${String(data.estado ?? "update")}`);
        const k = db.cadencias.find((x) => coincide(x, where))!;
        Object.assign(k, data);
        return k;
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: Fila; data: Fila }) => {
          const fs = db.cadencias.filter((x) => coincide(x, where));
          fs.forEach((f) => Object.assign(f, data));
          return { count: fs.length };
        },
      ),
    },
    copilotToque: {
      findUnique: vi.fn(
        async ({ where }: { where: Fila }) =>
          db.toques.find((t) => coincide(t, where)) ?? null,
      ),
      update: vi.fn(async ({ where, data }: { where: Fila; data: Fila }) =>
        Object.assign(
          db.toques.find((t) => coincide(t, where))!,
          data,
        ),
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: Fila; data: Fila }) => {
          const fs = db.toques.filter((x) => coincide(x, where));
          fs.forEach((f) => Object.assign(f, data));
          return { count: fs.length };
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: Fila }) => {
        db.orden.push("toques:borrar");
        const antes = db.toques.length;
        db.toques = db.toques.filter((t) => !coincide(t, where));
        return { count: antes - db.toques.length };
      }),
      createMany: vi.fn(async ({ data }: { data: Fila[] }) => {
        let n = 0;
        for (const d of data) {
          if (
            db.toques.some(
              (t) => t.cadenciaId === d.cadenciaId && t.codigo === d.codigo,
            )
          )
            continue;
          db.toques.push({
            id: `t${db.toques.length + 1}`,
            resultado: null,
            ...d,
          });
          n++;
        }
        return { count: n };
      }),
    },
    contact: {
      findMany: vi.fn(async ({ where }: { where: Fila }) =>
        db.contactos.filter((c) => coincide(c, where)),
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: Fila; data: Fila }) => {
          db.orden.push(`contacto:${String(data.estado)}`);
          const fs = db.contactos.filter((x) => coincide(x, where));
          fs.forEach((f) => Object.assign(f, data));
          return { count: fs.length };
        },
      ),
    },
  };

  return { db, cliente };
});

vi.mock("@/lib/db", () => ({ default: cliente }));

const AHORA = new Date("2026-11-06T16:00:00Z"); // día 2 de una cadencia que empezó el 05-nov

beforeEach(() => {
  db.cadencias = [
    {
      id: "k1",
      contactId: "c1",
      tipo: "NUEVOS",
      estado: "ACTIVA",
      inicio: new Date("2026-11-05T15:00:00Z"),
      diaInicio: new Date("2026-11-05T00:00:00Z"),
      horaEntrada: 10,
      modoSms: null,
      diaMaterializado: 1,
      primerIntentoAt: null,
    },
  ];
  db.toques = [
    {
      id: "L1",
      cadenciaId: "k1",
      contactId: "c1",
      dia: 1,
      codigo: "L1",
      canal: "LLAMADA",
      resultado: null,
    },
    {
      id: "WA1",
      cadenciaId: "k1",
      contactId: "c1",
      dia: 1,
      codigo: "WA1",
      canal: "WHATSAPP",
      resultado: null,
    },
    {
      id: "L2",
      cadenciaId: "k1",
      contactId: "c1",
      dia: 1,
      codigo: "L2",
      canal: "LLAMADA",
      resultado: "NO_CONTESTO",
    },
  ];
  db.contactos = [
    {
      id: "c1",
      estado: "NUEVO",
      phone: "+529841234567",
      leadSource: "META_ADS",
    },
  ];
  db.fuentes = [];
  db.orden = [];
});

describe("marcarResultado", () => {
  it("un intento (no contestó) pasa Nuevo → Sin respuesta y guarda el primer intento", async () => {
    const r = await marcarResultado({
      toqueId: "L1",
      resultado: "NO_CONTESTO",
      usuarioId: "u1",
      ahora: AHORA,
    });
    expect(r).toEqual({ ok: true, terminada: false });
    expect(db.contactos[0].estado).toBe("SIN_RESPUESTA");
    expect(db.cadencias[0].primerIntentoAt).toEqual(AHORA);
    expect(db.toques.find((t) => t.id === "L1")).toMatchObject({
      resultado: "NO_CONTESTO",
      resultadoPorId: "u1",
    });
    expect(db.fuentes).toEqual(["copilot_cadencia"]);
  });

  it("contestó una persona: termina la cadencia ANTES de mover el contacto, quita los pendientes y deja lo hecho", async () => {
    const r = await marcarResultado({
      toqueId: "L1",
      resultado: "CONTESTO",
      usuarioId: "u1",
      ahora: AHORA,
    });
    expect(r).toEqual({ ok: true, terminada: true });
    expect(db.cadencias[0]).toMatchObject({
      estado: "TERMINADA",
      motivoFin: "RESPONDIO",
      respuestaAt: AHORA,
    });
    expect(db.contactos[0]).toMatchObject({
      estado: "CONTACTADO",
      subestado: "EN_CONVERSACION",
    });
    expect(db.toques.map((t) => `${t.codigo}=${t.resultado}`)).toEqual([
      "L1=CONTESTO",
      "L2=NO_CONTESTO",
    ]);
    expect(db.orden).toEqual([
      "toques:borrar",
      "cadencia:TERMINADA",
      "contacto:CONTACTADO",
    ]);
  });

  it("«no se pudo» no cuenta como intento: el contacto sigue en Nuevo", async () => {
    await marcarResultado({
      toqueId: "WA1",
      resultado: "NO_SE_PUDO",
      usuarioId: "u1",
      ahora: AHORA,
    });
    expect(db.contactos[0].estado).toBe("NUEVO");
  });

  it("rechaza un resultado de otro canal, un toque de un día que no ha llegado y una cadencia terminada", async () => {
    expect(
      await marcarResultado({
        toqueId: "L1",
        resultado: "ENVIADO",
        usuarioId: "u1",
        ahora: AHORA,
      }),
    ).toMatchObject({ ok: false, status: 400 });
    db.toques.push({
      id: "L4",
      cadenciaId: "k1",
      contactId: "c1",
      dia: 4,
      codigo: "L4",
      canal: "LLAMADA",
      resultado: null,
    });
    expect(
      await marcarResultado({
        toqueId: "L4",
        resultado: "NO_CONTESTO",
        usuarioId: "u1",
        ahora: AHORA,
      }),
    ).toMatchObject({ ok: false, status: 409 });
    db.cadencias[0].estado = "TERMINADA";
    expect(
      await marcarResultado({
        toqueId: "L1",
        resultado: "NO_CONTESTO",
        usuarioId: "u1",
        ahora: AHORA,
      }),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      await marcarResultado({
        toqueId: "nada",
        resultado: null,
        usuarioId: "u1",
        ahora: AHORA,
      }),
    ).toMatchObject({ ok: false, status: 404 });
  });

  it("deshacer deja el toque pendiente otra vez", async () => {
    await marcarResultado({
      toqueId: "L2",
      resultado: null,
      usuarioId: "u1",
      ahora: AHORA,
    });
    expect(db.toques.find((t) => t.id === "L2")).toMatchObject({
      resultado: null,
      resultadoAt: null,
      resultadoPorId: null,
    });
  });
});

describe("materializarCadencias", () => {
  it("crea los toques de los días que llegaron (día 2: L3 y Correo 1) y no repite", async () => {
    expect(await materializarCadencias({ ahora: AHORA })).toEqual({
      cadencias: 1,
      toques: 2,
    });
    const d2 = db.toques.filter((t) => t.dia === 2);
    expect(d2.map((t) => t.codigo)).toEqual(["L3", "CORREO1"]);
    // Aparecen al empezar su día en Cancún (00:00 = 05:00 UTC): de ahí se cuentan las 24 h.
    expect(d2[0].createdAt).toEqual(new Date("2026-11-06T05:00:00Z"));
    expect(db.cadencias[0].diaMaterializado).toBe(2);
    expect(await materializarCadencias({ ahora: AHORA })).toEqual({
      cadencias: 0,
      toques: 0,
    });
  });

  it("si el cron estuvo parado, se ponen al día los días atrasados", async () => {
    await materializarCadencias({ ahora: new Date("2026-11-09T16:00:00Z") }); // día 5
    expect([...new Set(db.toques.map((t) => t.dia))]).toEqual([1, 2, 4, 5]);
  });
});

describe("terminarCadenciasVencidas", () => {
  it("el día 16 sin respuesta: Perdido · Sin respuesta tras cadencia, y lo pendiente queda como «no se hizo»", async () => {
    const r = await terminarCadenciasVencidas(new Date("2026-11-20T16:00:00Z")); // día 16
    expect(r).toEqual({ terminadas: 1, aPerdido: 1 });
    expect(db.contactos[0]).toMatchObject({
      estado: "PERDIDO",
      razonSalida: "SIN_RESPUESTA_TRAS_CADENCIA",
    });
    expect(db.cadencias[0]).toMatchObject({
      estado: "TERMINADA",
      motivoFin: "SIN_RESPUESTA",
    });
    expect(db.toques.map((t) => t.resultado)).toEqual([
      "NO_HECHO",
      "NO_HECHO",
      "NO_CONTESTO",
    ]);
  });

  it("el día 15 todavía no termina", async () => {
    expect(
      await terminarCadenciasVencidas(new Date("2026-11-19T16:00:00Z")),
    ).toEqual({ terminadas: 0, aPerdido: 0 });
  });
});

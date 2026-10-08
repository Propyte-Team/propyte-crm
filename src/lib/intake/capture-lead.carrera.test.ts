import { describe, it, expect, vi, beforeEach } from "vitest";

// #844 — dos mensajes casi simultáneos de una persona NUEVA por WhatsApp creaban dos
// contactos. Caso real 2026-10-03: contactos creados con 6 ms de diferencia, mismo teléfono.
//
// Aquí se simula una base con latencia real entre "buscar" y "crear" (un await entre
// cada operación, como en Postgres) para que las dos peticiones se entrelacen.

type Row = { id: string; phone: string; assignedToId: string | null };

// vi.hoisted: los vi.mock se elevan al inicio del archivo, así que lo que usan sus
// fábricas tiene que declararse igual de arriba.
const { rows, state, db } = vi.hoisted(() => {
  const rows: Array<{ id: string; phone: string; assignedToId: string | null }> = [];
  const state = { creates: 0 };
  const db = {
    leadConnector: { findUnique: async () => null },
    contact: {
      findFirst: async ({ where }: { where: { OR: Array<{ phone?: string }> } }) => {
        await new Promise((r) => setTimeout(r, 5)); // latencia de la consulta
        const phones = where.OR.map((c) => c.phone).filter(Boolean);
        return rows.find((r) => phones.includes(r.phone)) ?? null;
      },
      create: async ({ data }: { data: { phone: string } }) => {
        await new Promise((r) => setTimeout(r, 5));
        state.creates++;
        const row = { id: `c-${state.creates}`, phone: data.phone, assignedToId: null };
        rows.push(row);
        return row;
      },
      update: async () => ({}),
    },
    activity: { create: async () => ({}) },
    user: { findFirst: async () => ({ id: "u-admin" }) },
    adAttribution: { findUnique: async () => null, create: async () => ({}) },
  };
  return { rows, state, db };
});
vi.mock("@/lib/db", () => ({ default: db }));
vi.mock("@/lib/workflows/routing", () => ({ autoRouteLead: vi.fn(async () => null) }));
vi.mock("@/lib/workflows/events", () => ({ emitEvent: vi.fn() }));
vi.mock("@/lib/capi/events", () => ({ recordConversionEvent: vi.fn() }));

// El candado de prueba: exclusión mutua por llave, igual que pg_advisory_xact_lock —
// quien llega segundo espera a que el primero termine por completo.
const lock = vi.hoisted(() => ({ on: true, colas: new Map<string, Promise<unknown>>() }));
vi.mock("@/lib/intake/intake-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intake/intake-lock")>();
  return {
    ...actual,
    withIntakeLock: async (key: string | null, fn: (d: unknown) => Promise<unknown>) => {
      if (!lock.on || !key) return fn(db);
      const previa = lock.colas.get(key) ?? Promise.resolve();
      const mia = previa.then(() => fn(db));
      lock.colas.set(key, mia.catch(() => undefined));
      return mia;
    },
  };
});

import { captureLead } from "./capture-lead";

const mensaje = (texto: string) =>
  captureLead({ source: "WHATSAPP", firstName: "Tisiano", lastName: "(por identificar)", phone: "+529841364211", message: texto });

beforeEach(() => {
  rows.length = 0;
  state.creates = 0;
  lock.colas.clear();
  lock.on = true;
});

describe("captureLead — carrera entre dos mensajes simultáneos de la misma persona (#844)", () => {
  it("SIN el candado la carrera se reproduce: dos altas del mismo teléfono (el defecto original)", async () => {
    lock.on = false;
    const [a, b] = await Promise.all([mensaje("Hola! Buenos días"), mensaje("Mi nombre es Tisiano")]);

    expect(state.creates).toBe(2);
    expect(a.contactId).not.toBe(b.contactId);
  });

  it("CON el candado: una sola alta; el segundo mensaje reutiliza el contacto del primero", async () => {
    const [a, b] = await Promise.all([mensaje("Hola! Buenos días"), mensaje("Mi nombre es Tisiano")]);

    expect(state.creates).toBe(1);
    expect(a.contactId).toBe(b.contactId);
    // exactamente uno de los dos fue el alta; el otro es "lead repetido"
    expect([a.isNew, b.isNew].filter(Boolean)).toHaveLength(1);
  });

  it("teléfonos DISTINTOS no se esperan entre sí: cada uno crea su contacto", async () => {
    const otro = captureLead({ source: "WHATSAPP", firstName: "Ana", lastName: "X", phone: "+529981112233", message: "hola" });
    const [a, b] = await Promise.all([mensaje("hola"), otro]);

    expect(state.creates).toBe(2);
    expect(a.contactId).not.toBe(b.contactId);
  });
});

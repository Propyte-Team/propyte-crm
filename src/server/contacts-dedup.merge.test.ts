import { describe, it, expect, vi, beforeEach } from "vitest";

// #903: fusionar duplicados archiva al que se fusiona. Antes conservaba sus ids de canal
// (Instagram, Messenger, WhatsApp), que son únicos: cuando la persona volvía a escribir por ese
// canal, nadie la encontraba (el intake solo mira vivos) y su alta chocaba con el id ocupado.
// Ahora los ids pasan al que queda —si no tiene el suyo— y el fusionado los suelta.
//
// La tabla de contactos es de mentira pero respeta los tres índices únicos, así que también
// fija el ORDEN: soltar primero y dar después.

type Fila = {
  id: string;
  firstName: string;
  email: string | null;
  secondaryPhone: string | null;
  leadSourceDetail: string | null;
  originalCreatedAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  mergedIntoId: string | null;
  instagramId: string | null;
  messengerPsid: string | null;
  whatsappUserId: string | null;
};
const UNICOS = ["instagramId", "messengerPsid", "whatsappUserId"] as const;

let tabla: Fila[] = [];

const contact = {
  findFirst: async ({ where }: { where: Partial<Fila> }) =>
    tabla.find((f) => Object.entries(where).every(([k, v]) => (f as Record<string, unknown>)[k] === v)) ?? null,
  update: async ({ where, data }: { where: { id: string }; data: Partial<Fila> }) => {
    const f = tabla.find((x) => x.id === where.id)!;
    const nueva = { ...f, ...data };
    for (const campo of UNICOS) {
      const v = nueva[campo];
      if (v && tabla.some((o) => o.id !== f.id && o[campo] === v)) {
        throw Object.assign(new Error(`Unique constraint failed on the fields: (\`${campo}\`)`), { code: "P2002" });
      }
    }
    Object.assign(f, nueva);
    return f;
  },
};

// Las relaciones (negocios, actividades, mensajes…) no importan aquí: se mueven y ya.
const relacion = { updateMany: async () => ({ count: 0 }), findMany: async () => [], count: async () => 0 };
// El registro de fusiones (#977) guarda en SystemConfig; aquí no importa.
const systemConfig = { findUnique: async () => null, upsert: async () => ({}) };
const tx = new Proxy({ contact, systemConfig } as Record<string, unknown>, {
  get: (obj, prop: string) => (prop in obj ? obj[prop] : relacion),
});

vi.mock("@/lib/db", () => ({ default: { $transaction: (fn: (t: unknown) => unknown) => fn(tx) } }));
vi.mock("@/lib/audit/change-context", () => ({ setChangeSource: vi.fn() }));

import { mergeContacts } from "./contacts-dedup";

function fila(id: string, extra: Partial<Fila> = {}): Fila {
  return {
    id,
    firstName: id,
    email: null,
    secondaryPhone: null,
    leadSourceDetail: null,
    originalCreatedAt: null,
    createdAt: new Date("2026-10-01"),
    deletedAt: null,
    mergedIntoId: null,
    instagramId: null,
    messengerPsid: null,
    whatsappUserId: null,
    ...extra,
  };
}

const de = (id: string) => tabla.find((f) => f.id === id)!;

beforeEach(() => {
  tabla = [];
});

describe("mergeContacts — los ids de canal del fusionado (#903)", () => {
  it("pasan al que queda y el fusionado los suelta", async () => {
    tabla = [
      fila("queda", { messengerPsid: "psid-ana" }),
      fila("se-va", { instagramId: "ig-ana", whatsappUserId: "MX.bsuid-ana" }),
    ];
    const r = await mergeContacts({ survivorId: "queda", loserId: "se-va" });
    expect(r).toEqual({ survivorId: "queda" });

    expect(de("queda")).toMatchObject({ instagramId: "ig-ana", messengerPsid: "psid-ana", whatsappUserId: "MX.bsuid-ana" });
    expect(de("se-va")).toMatchObject({ mergedIntoId: "queda", instagramId: null, messengerPsid: null, whatsappUserId: null });
    expect(de("se-va").deletedAt).toBeInstanceOf(Date);
  });

  it("si el que queda ya tiene id en ese canal, se queda el suyo y el del fusionado se suelta", async () => {
    tabla = [fila("queda", { instagramId: "ig-cuenta-1" }), fila("se-va", { instagramId: "ig-cuenta-2" })];
    await mergeContacts({ survivorId: "queda", loserId: "se-va" });
    expect(de("queda").instagramId).toBe("ig-cuenta-1");
    expect(de("se-va").instagramId).toBeNull();
  });

  it("sin ids de canal en ninguno, la fusión sigue igual que antes", async () => {
    tabla = [fila("queda"), fila("se-va", { email: "ana@x.com" })];
    await mergeContacts({ survivorId: "queda", loserId: "se-va" });
    expect(de("queda").email).toBe("ana@x.com");
    expect(de("se-va").mergedIntoId).toBe("queda");
  });
});

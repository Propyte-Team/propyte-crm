import { describe, it, expect, vi, beforeEach } from "vitest";

// #903: borrar un contacto (borrado lógico) tiene que soltar sus ids de canal. Instagram, Messenger
// y WhatsApp son únicos en la base, pero el intake y el inbox solo buscan contactos vivos: si el
// archivado los retenía, cuando esa persona volvía a escribir nadie la encontraba, el alta nueva
// chocaba con el id ocupado (P2002) y el prospecto se perdía.
//
// La tabla de contactos es de mentira pero respeta lo que importa aquí: los tres índices únicos.

type Fila = {
  id: string;
  firstName: string;
  assignedToId: string | null;
  deletedAt: Date | null;
  mergedIntoId: string | null;
  instagramId: string | null;
  messengerPsid: string | null;
  whatsappUserId: string | null;
};
const UNICOS = ["instagramId", "messengerPsid", "whatsappUserId"] as const;

let tabla: Fila[] = [];

function errorUnico(campo: string) {
  return Object.assign(new Error(`Unique constraint failed on the fields: (\`${campo}\`)`), { code: "P2002" });
}

function revisarUnicos(fila: Fila) {
  for (const campo of UNICOS) {
    const v = fila[campo];
    if (v && tabla.some((o) => o.id !== fila.id && o[campo] === v)) throw errorUnico(campo);
  }
}

type Where = Partial<Fila> & { OR?: Partial<Fila>[] };
function casa(f: Fila, where: Where): boolean {
  const { OR, ...resto } = where;
  for (const [k, v] of Object.entries(resto)) if ((f as Record<string, unknown>)[k] !== v) return false;
  return !OR || OR.some((o) => casa(f, o));
}

const db = {
  findFirst: async ({ where }: { where: Where }) => tabla.find((f) => casa(f, where)) ?? null,
  update: async ({ where, data }: { where: { id: string }; data: Partial<Fila> }) => {
    const f = tabla.find((x) => x.id === where.id);
    if (!f) throw new Error("no existe");
    const nueva = { ...f, ...data };
    revisarUnicos(nueva);
    Object.assign(f, nueva);
    return f;
  },
  create: async ({ data }: { data: Partial<Fila> }) => {
    const nueva: Fila = {
      id: `nuevo-${tabla.length + 1}`,
      firstName: "",
      assignedToId: null,
      deletedAt: null,
      mergedIntoId: null,
      instagramId: null,
      messengerPsid: null,
      whatsappUserId: null,
      ...data,
    };
    revisarUnicos(nueva);
    tabla.push(nueva);
    return nueva;
  },
};

// Getter: vi.mock se eleva al principio del archivo, antes de que exista `db`.
vi.mock("@/lib/db", () => ({
  default: {
    get contact() {
      return db;
    },
  },
}));

const getServerSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getServerSession: () => getServerSession() }));

vi.mock("@/lib/audit/change-context", () => ({
  withChangeSource: (_opts: unknown, fn: (tx: unknown) => unknown) => fn({ contact: db }),
}));

// La puerta de acceso se prueba en route.acceso.test.ts (#908).
vi.mock("@/server/contacts", () => ({
  getContactAccessInfo: vi.fn(async () => ({ ok: true, contact: {} })),
}));

import { DELETE } from "./route";

const ADMIN = { user: { id: "adm", role: "ADMIN", plaza: "PDC", name: "Admin" } };

function borrar(id: string) {
  return DELETE(new Request(`https://x/api/contacts?id=${id}`, { method: "DELETE" }) as never);
}

/**
 * Lo que hace el intake (capture-lead / inbox) cuando llega un mensaje: busca al remitente SOLO
 * entre los contactos vivos y, si no lo encuentra, lo da de alta con su id de canal.
 */
async function vuelveAEscribir(canal: (typeof UNICOS)[number], valor: string) {
  const vivo = await db.findFirst({ where: { [canal]: valor, deletedAt: null, mergedIntoId: null } });
  if (vivo) return vivo;
  return db.create({ data: { firstName: "Nuevo", [canal]: valor } });
}

beforeEach(() => {
  getServerSession.mockReset();
  getServerSession.mockResolvedValue(ADMIN);
  tabla = [
    {
      id: "c1",
      firstName: "Ana",
      assignedToId: "ase-1",
      deletedAt: null,
      mergedIntoId: null,
      instagramId: "ig-ana",
      messengerPsid: "psid-ana",
      whatsappUserId: "MX.bsuid-ana",
    },
  ];
});

describe("DELETE /api/contacts — archivar suelta los ids de canal (#903)", () => {
  it("el contacto queda archivado y sin Instagram, Messenger ni WhatsApp", async () => {
    const res = await borrar("c1");
    expect(res.status).toBe(200);
    const archivado = tabla.find((f) => f.id === "c1")!;
    expect(archivado.deletedAt).toBeInstanceOf(Date);
    expect(archivado.instagramId).toBeNull();
    expect(archivado.messengerPsid).toBeNull();
    expect(archivado.whatsappUserId).toBeNull();
    expect(archivado.firstName).toBe("Ana"); // lo demás no se toca
  });

  it.each([
    ["instagramId", "ig-ana"],
    ["messengerPsid", "psid-ana"],
    ["whatsappUserId", "MX.bsuid-ana"],
  ] as const)("si la persona vuelve a escribir por %s, se da de alta como contacto nuevo", async (canal, valor) => {
    await borrar("c1");
    const nuevo = await vuelveAEscribir(canal, valor);
    expect(nuevo.id).not.toBe("c1");
    expect(nuevo[canal]).toBe(valor);
    expect(nuevo.deletedAt).toBeNull();
  });
});

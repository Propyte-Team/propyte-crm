import { describe, it, expect, vi, beforeEach } from "vitest";

// El db por defecto (`@/lib/db`) apunta al mismo doble que las pruebas pasan por `opts.db`:
// así una prueba puede comprobar que, sin `db`, se usa el cliente de siempre.
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({
  default: new Proxy({}, { get: (_t, k) => (holder.db as Record<string | symbol, unknown>)[k] }),
}));

import { resolveActorUserId, crearCacheDeActor, type ActorDb } from "./actor-sistema";

// ─────────────── Un db de juguete que EVALÚA los `where` ───────────────
//
// No se comprueba la forma exacta de cada consulta (eso ataría la prueba a la sintaxis de
// Prisma): se evalúan contra filas en memoria, así «la cuenta técnica no firma» se prueba
// con una cuenta técnica de verdad y no con un mock que devuelve null porque sí. Solo
// entiende las formas que usa el helper: igualdad, `NOT`, `email.endsWith` y los filtros de
// relación `{ is: ... }`.

interface Usuario {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
}
interface Marca {
  id: string;
  deletedAt: Date | null;
  marketingOwnerUserId: string | null;
}
interface Cuenta {
  id: string;
  brandId: string | null;
}
interface Hilo {
  id: string;
  connectorId: string | null;
}

type Where = Record<string, unknown>;

const d = (s: string) => new Date(s);
const persona = (id: string, role: string, createdAt: string, extra: Partial<Usuario> = {}): Usuario => ({
  id,
  email: `${id}@propyte.com`,
  role,
  isActive: true,
  deletedAt: null,
  createdAt: d(createdAt),
  ...extra,
});

/** Las cuentas técnicas de verdad: dominio `.local`, activas, una de ellas ADMIN. */
const AUDIT_TEMP = persona("u-audit", "ADMIN", "2026-01-01T00:00:00Z", { email: "audit-temp@propyte.local" });
const AGENTES = persona("u-agentes", "ASESOR", "2026-01-01T00:00:00Z", { email: "agentes@propyte.local" });

const USUARIOS: Usuario[] = [
  AUDIT_TEMP, // ADMIN y el más antiguo de todos… pero técnico
  persona("u-admin-inactivo", "ADMIN", "2025-06-01T00:00:00Z", { isActive: false }),
  persona("u-admin-borrado", "ADMIN", "2025-07-01T00:00:00Z", { deletedAt: d("2026-02-01T00:00:00Z") }),
  persona("u-gerente", "GERENTE", "2025-01-01T00:00:00Z"), // más antiguo, pero no es ADMIN
  persona("u-luis", "ADMIN", "2026-04-15T01:20:45Z"),
  persona("u-conrad", "ADMIN", "2026-05-01T00:00:00Z"),
  AGENTES,
  persona("u-ana", "ASESOR", "2026-06-01T00:00:00Z"),
  persona("u-ex", "ASESOR", "2026-06-01T00:00:00Z", { isActive: false }),
  persona("u-borrada", "ASESOR", "2026-06-01T00:00:00Z", { deletedAt: d("2026-09-01T00:00:00Z") }),
  persona("u-mkt", "MARKETING", "2026-07-01T00:00:00Z"),
];

const MARCAS: Marca[] = [
  { id: "b-yax", deletedAt: null, marketingOwnerUserId: "u-mkt" },
  { id: "b-otra", deletedAt: null, marketingOwnerUserId: "u-ana" },
  { id: "b-tecnica", deletedAt: null, marketingOwnerUserId: "u-agentes" },
  { id: "b-inactivo", deletedAt: null, marketingOwnerUserId: "u-ex" },
  { id: "b-borrada", deletedAt: d("2026-09-01T00:00:00Z"), marketingOwnerUserId: "u-mkt" },
  { id: "b-sin-responsable", deletedAt: null, marketingOwnerUserId: null },
];
const CUENTAS: Cuenta[] = [
  { id: "c-yax", brandId: "b-yax" },
  { id: "c-tecnica", brandId: "b-tecnica" },
  { id: "c-sin-marca", brandId: null },
];
const HILOS: Hilo[] = [
  { id: "conv-yax", connectorId: "c-yax" },
  { id: "conv-global", connectorId: null },
];

function cumple<T extends object>(fila: T, where: Where, relaciones: Record<string, (f: T, w: Where) => boolean> = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "NOT") {
      if (cumple(fila, v as Where, relaciones)) return false;
      continue;
    }
    if (k in relaciones) {
      if (!relaciones[k](fila, (v as { is: Where }).is)) return false;
      continue;
    }
    const valor = (fila as Record<string, unknown>)[k];
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const filtro = v as { endsWith?: string };
      if (filtro.endsWith !== undefined && !(typeof valor === "string" && valor.endsWith(filtro.endsWith))) return false;
      continue;
    }
    if (valor !== v) return false;
  }
  return true;
}

function crearDb(usuarios: Usuario[] = USUARIOS) {
  const usuarioCumple = (u: Usuario, w: Where) => cumple(u, w);
  const marcaCumple = (m: Marca, w: Where) =>
    cumple(m, w, {
      marketingOwner: (f, wu) => {
        const u = usuarios.find((x) => x.id === f.marketingOwnerUserId);
        return !!u && usuarioCumple(u, wu);
      },
    });
  const cuentaCumple = (c: Cuenta, w: Where) =>
    cumple(c, w, {
      brand: (f, wb) => {
        const m = MARCAS.find((x) => x.id === f.brandId);
        return !!m && marcaCumple(m, wb);
      },
    });
  const hiloCumple = (h: Hilo, w: Where) =>
    cumple(h, w, {
      connector: (f, wc) => {
        const c = CUENTAS.find((x) => x.id === f.connectorId);
        return !!c && cuentaCumple(c, wc);
      },
    });
  const marcaDe = (brandId: string | null) => {
    const m = MARCAS.find((x) => x.id === brandId);
    return m ? { marketingOwnerUserId: m.marketingOwnerUserId } : null;
  };

  const user = {
    findFirst: vi.fn(async ({ where, orderBy }: { where: Where; orderBy?: Array<Record<string, "asc" | "desc">> }) => {
      let filas = usuarios.filter((u) => usuarioCumple(u, where));
      if (orderBy) {
        filas = [...filas].sort((a, b) => {
          for (const o of orderBy) {
            const [campo, dir] = Object.entries(o)[0];
            const va = (a as unknown as Record<string, unknown>)[campo] as Date | string;
            const vb = (b as unknown as Record<string, unknown>)[campo] as Date | string;
            const cmp = va < vb ? -1 : va > vb ? 1 : 0;
            if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
          }
          return 0;
        });
      }
      return filas[0] ? { id: filas[0].id } : null;
    }),
  };
  const brand = {
    findFirst: vi.fn(async ({ where }: { where: Where }) => {
      const m = MARCAS.find((x) => marcaCumple(x, where));
      return m ? { marketingOwnerUserId: m.marketingOwnerUserId } : null;
    }),
  };
  const leadConnector = {
    findFirst: vi.fn(async ({ where }: { where: Where }) => {
      const c = CUENTAS.find((x) => cuentaCumple(x, where));
      return c ? { brand: marcaDe(c.brandId) } : null;
    }),
  };
  const conversation = {
    findFirst: vi.fn(async ({ where }: { where: Where }) => {
      const h = HILOS.find((x) => hiloCumple(x, where));
      if (!h) return null;
      const c = CUENTAS.find((x) => x.id === h.connectorId);
      return { connector: c ? { brand: marcaDe(c.brandId) } : null };
    }),
  };
  return { user, brand, leadConnector, conversation };
}

let db: ReturnType<typeof crearDb>;
const comoDb = (x: ReturnType<typeof crearDb>) => x as unknown as ActorDb;

beforeEach(() => {
  db = crearDb();
  holder.db = db;
});

describe("resolveActorUserId — a) el asesor del contacto", () => {
  it("asesor persona y activo: es él, y no se consulta nada más", async () => {
    expect(await resolveActorUserId({ assignedToId: "u-ana", connectorId: "c-yax" }, { db: comoDb(db) })).toBe("u-ana");
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
    expect(db.leadConnector.findFirst).not.toHaveBeenCalled();
  });

  it("asesor que es cuenta técnica (agentes@propyte.local): se salta", async () => {
    expect(await resolveActorUserId({ assignedToId: AGENTES.id }, { db: comoDb(db) })).toBe("u-luis");
  });

  it("asesor desactivado: se salta", async () => {
    expect(await resolveActorUserId({ assignedToId: "u-ex" }, { db: comoDb(db) })).toBe("u-luis");
  });

  it("asesor borrado (soft delete): se salta", async () => {
    expect(await resolveActorUserId({ assignedToId: "u-borrada" }, { db: comoDb(db) })).toBe("u-luis");
  });

  it("asesor que ya no existe: se salta", async () => {
    expect(await resolveActorUserId({ assignedToId: "u-fantasma" }, { db: comoDb(db) })).toBe("u-luis");
  });

  it("el filtro de persona es el de ruteables (activo, no borrado, no `.local`)", async () => {
    await resolveActorUserId({ assignedToId: "u-ana" }, { db: comoDb(db) });
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { id: "u-ana", isActive: true, deletedAt: null, NOT: { email: { endsWith: ".local" } } },
      select: { id: true },
    });
  });
});

describe("resolveActorUserId — b) el responsable de marketing de la marca", () => {
  it("marca explícita: su responsable", async () => {
    expect(await resolveActorUserId({ assignedToId: AGENTES.id, brandId: "b-yax" }, { db: comoDb(db) })).toBe("u-mkt");
  });

  it("por la cuenta: el responsable de la marca de la cuenta", async () => {
    expect(await resolveActorUserId({ assignedToId: AGENTES.id, connectorId: "c-yax" }, { db: comoDb(db) })).toBe("u-mkt");
  });

  it("por el hilo: el responsable de la marca de la cuenta del hilo", async () => {
    expect(await resolveActorUserId({ assignedToId: null, conversationId: "conv-yax" }, { db: comoDb(db) })).toBe("u-mkt");
  });

  it("la marca explícita gana sobre la cuenta, y la cuenta sobre el hilo", async () => {
    expect(
      await resolveActorUserId({ brandId: "b-otra", connectorId: "c-yax", conversationId: "conv-yax" }, { db: comoDb(db) }),
    ).toBe("u-ana");
    expect(db.leadConnector.findFirst).not.toHaveBeenCalled();
    expect(db.conversation.findFirst).not.toHaveBeenCalled();

    expect(await resolveActorUserId({ connectorId: "c-tecnica", conversationId: "conv-yax" }, { db: comoDb(db) })).toBe(
      "u-luis",
    );
    expect(db.conversation.findFirst).not.toHaveBeenCalled();
  });

  it("responsable que es cuenta técnica: se salta", async () => {
    expect(await resolveActorUserId({ connectorId: "c-tecnica" }, { db: comoDb(db) })).toBe("u-luis");
  });

  it("responsable desactivado: se salta", async () => {
    expect(await resolveActorUserId({ brandId: "b-inactivo" }, { db: comoDb(db) })).toBe("u-luis");
  });

  it("marca borrada: no cuenta", async () => {
    expect(await resolveActorUserId({ brandId: "b-borrada" }, { db: comoDb(db) })).toBe("u-luis");
  });

  it("marca sin responsable, cuenta sin marca o hilo del número global: al ADMIN", async () => {
    expect(await resolveActorUserId({ brandId: "b-sin-responsable" }, { db: comoDb(db) })).toBe("u-luis");
    expect(await resolveActorUserId({ connectorId: "c-sin-marca" }, { db: comoDb(db) })).toBe("u-luis");
    expect(await resolveActorUserId({ conversationId: "conv-global" }, { db: comoDb(db) })).toBe("u-luis");
  });

  it("si la lectura de la marca falla, se sigue con el ADMIN y queda registrado", async () => {
    db.leadConnector.findFirst.mockRejectedValueOnce(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolveActorUserId({ connectorId: "c-yax" }, { db: comoDb(db) })).toBe("u-luis");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[actor]"), expect.any(Error));
    error.mockRestore();
  });

  it("migración de marcas sin aplicar (P2021/P2022): se sigue con el ADMIN, sin ruido", async () => {
    db.brand.findFirst.mockRejectedValueOnce(Object.assign(new Error("tabla"), { code: "P2021" }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolveActorUserId({ brandId: "b-yax" }, { db: comoDb(db) })).toBe("u-luis");
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("resolveActorUserId — c) el ADMIN persona más antiguo", () => {
  it("salta la cuenta técnica aunque sea el ADMIN más antiguo (Audit Temp)", async () => {
    expect(await resolveActorUserId({}, { db: comoDb(db) })).toBe("u-luis");
  });

  it("salta ADMIN desactivados o borrados más antiguos, e ignora otros roles", async () => {
    // u-gerente es el usuario más antiguo de todos, pero no es ADMIN.
    expect(await resolveActorUserId({ assignedToId: null }, { db: comoDb(db) })).toBe("u-luis");
  });

  it("determinista: el mismo resultado sin importar el orden en que la base devuelva las filas", async () => {
    const alReves = crearDb([...USUARIOS].reverse());
    expect(await resolveActorUserId({}, { db: comoDb(alReves) })).toBe("u-luis");
  });

  it("empate de createdAt: desempata por id", async () => {
    const mismoInstante = "2026-03-01T00:00:00Z";
    const empate = crearDb([persona("u-b", "ADMIN", mismoInstante), persona("u-a", "ADMIN", mismoInstante)]);
    expect(await resolveActorUserId({}, { db: comoDb(empate) })).toBe("u-a");
  });

  it("pide el orden a la base (createdAt asc, id asc), no lo deja al azar", async () => {
    await resolveActorUserId({}, { db: comoDb(db) });
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { role: "ADMIN", isActive: true, deletedAt: null, NOT: { email: { endsWith: ".local" } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
  });
});

describe("resolveActorUserId — d) nadie", () => {
  const soloTecnicas = () => crearDb([AUDIT_TEMP, AGENTES, persona("u-ex", "ADMIN", "2025-01-01T00:00:00Z", { isActive: false })]);

  it("sin ninguna persona a quien atribuir: null, nunca un id inventado", async () => {
    expect(await resolveActorUserId({ assignedToId: AGENTES.id, connectorId: "c-tecnica" }, { db: comoDb(soloTecnicas()) })).toBeNull();
    expect(await resolveActorUserId({}, { db: comoDb(soloTecnicas()) })).toBeNull();
  });
});

describe("resolveActorUserId — e) último recurso (solo si se pide)", () => {
  const soloTecnicas = () => crearDb([AUDIT_TEMP, AGENTES]);

  it("con asesor: el asesor tal cual, aunque sea técnico (la regla de antes)", async () => {
    expect(
      await resolveActorUserId({ assignedToId: AGENTES.id }, { db: comoDb(soloTecnicas()), ultimoRecurso: true }),
    ).toBe(AGENTES.id);
  });

  it("sin asesor: el ADMIN activo más antiguo, aunque sea técnico", async () => {
    expect(await resolveActorUserId({}, { db: comoDb(soloTecnicas()), ultimoRecurso: true })).toBe(AUDIT_TEMP.id);
  });

  it("no cambia nada cuando a–c sí encuentran a una persona", async () => {
    expect(await resolveActorUserId({ assignedToId: AGENTES.id }, { db: comoDb(db), ultimoRecurso: true })).toBe("u-luis");
  });
});

describe("resolveActorUserId — coste", () => {
  it("con caché, el ADMIN de respaldo se consulta una sola vez por lote", async () => {
    const cache = crearCacheDeActor();
    for (const assignedToId of [AGENTES.id, "u-ex", null, AGENTES.id]) {
      expect(await resolveActorUserId({ assignedToId }, { db: comoDb(db), cache })).toBe("u-luis");
    }
    const consultasDeAdmin = db.user.findFirst.mock.calls.filter(([a]) => (a.where as Where).role === "ADMIN");
    expect(consultasDeAdmin).toHaveLength(1);
    // Una por asesor distinto (u-agentes, u-ex): el repetido sale de la caché.
    expect(db.user.findFirst).toHaveBeenCalledTimes(3);
  });

  it("con caché, la marca de una cuenta se lee una vez", async () => {
    const cache = crearCacheDeActor();
    await resolveActorUserId({ connectorId: "c-yax" }, { db: comoDb(db), cache });
    await resolveActorUserId({ connectorId: "c-yax" }, { db: comoDb(db), cache });
    expect(db.leadConnector.findFirst).toHaveBeenCalledTimes(1);
  });

  it("la caché no guarda fallos: la siguiente llamada reintenta", async () => {
    const cache = crearCacheDeActor();
    db.user.findFirst.mockRejectedValueOnce(new Error("db down"));
    await expect(resolveActorUserId({ assignedToId: "u-ana" }, { db: comoDb(db), cache })).rejects.toThrow("db down");
    expect(await resolveActorUserId({ assignedToId: "u-ana" }, { db: comoDb(db), cache })).toBe("u-ana");
  });

  it("sin caché, cada llamada consulta (no hay memoria global que se quede vieja)", async () => {
    await resolveActorUserId({}, { db: comoDb(db) });
    await resolveActorUserId({}, { db: comoDb(db) });
    expect(db.user.findFirst).toHaveBeenCalledTimes(2);
  });
});

describe("resolveActorUserId — cliente por defecto", () => {
  it("sin `db`, usa el de @/lib/db", async () => {
    expect(await resolveActorUserId({ assignedToId: "u-ana" })).toBe("u-ana");
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
  });
});

// src/lib/inbox/scope.test.ts
import { describe, it, expect } from "vitest";
import type { Prisma } from "@prisma/client";
import { inboxScopeWhere, canViewInboxContact, type InboxScopeUser } from "./scope";
import type { VisibleBrands } from "@/lib/brands/visibility";

// Fila de contacto tal como la devolvería el select del inbox.
type FilaContacto = { assignedToId: string | null; assignedTo: { teamLeaderId: string | null } | null };

const TL_ID = "tl-1";

const USUARIOS: Record<string, InboxScopeUser> = {
  ADMIN: { id: "adm-1", role: "ADMIN" },
  GERENTE: { id: "ger-1", role: "GERENTE" },
  TEAM_LEADER: { id: TL_ID, role: "TEAM_LEADER" },
  ASESOR_SR: { id: "ase-1", role: "ASESOR_SR" },
};

// Los contactos dependen de quién pregunta ("propio"), así que se construyen por usuario.
function contactosPara(user: InboxScopeUser): Record<string, FilaContacto> {
  return {
    "sin asignar": { assignedToId: null, assignedTo: null },
    propio: { assignedToId: user.id, assignedTo: { teamLeaderId: null } },
    "de un reporte directo del TL": { assignedToId: "rep-1", assignedTo: { teamLeaderId: TL_ID } },
    ajeno: { assignedToId: "extra-1", assignedTo: { teamLeaderId: "otro-tl" } },
  };
}

// Veredicto esperado [sin asignar, propio, de un reporte del TL, ajeno]
const ESPERADO: Record<string, boolean[]> = {
  ADMIN: [true, true, true, true],
  GERENTE: [true, true, true, true],
  TEAM_LEADER: [true, true, true, false],
  ASESOR_SR: [true, true, false, false],
};

// Evaluador MANUAL del where de Prisma sobre una fila en memoria. Reproduce la semántica
// de Postgres/Prisma, no llama a canViewInboxContact — si lo hiciera, la paridad sería
// una tautología. Cualquier término que no reconozca LANZA: si mañana inboxScopeWhere
// agrega una forma nueva, este test rompe en vez de aprobarla sin mirar.
function matchesWhere(where: Prisma.ContactWhereInput | undefined, fila: FilaContacto): boolean {
  if (where === undefined) return true; // sin filtro = pasa todo
  const terminos = where.OR;
  if (!Array.isArray(terminos)) throw new Error("se esperaba un OR de términos");

  return terminos.some((termino) => {
    const t = termino as { assignedToId?: string | null; assignedTo?: { is?: { teamLeaderId?: string } } };
    if (t.assignedToId !== undefined) return fila.assignedToId === t.assignedToId;
    if (t.assignedTo !== undefined) {
      const is = t.assignedTo.is;
      if (!is || typeof is.teamLeaderId !== "string") {
        throw new Error(`filtro de relación no soportado: ${JSON.stringify(termino)}`);
      }
      // Relación to-one nullable: `is` NUNCA empareja si la relación está vacía.
      return fila.assignedTo !== null && fila.assignedTo.teamLeaderId === is.teamLeaderId;
    }
    throw new Error(`término no soportado por el evaluador: ${JSON.stringify(termino)}`);
  });
}

describe("alcance del inbox — paridad where ↔ chequeo en memoria", () => {
  for (const [nombreRol, user] of Object.entries(USUARIOS)) {
    const contactos = Object.entries(contactosPara(user));
    contactos.forEach(([nombreContacto, fila], i) => {
      it(`${nombreRol} × contacto ${nombreContacto} → ${ESPERADO[nombreRol][i] ? "ve" : "NO ve"}`, () => {
        const esperado = ESPERADO[nombreRol][i];
        const enMemoria = canViewInboxContact(fila, user, "ALL");
        const porQuery = matchesWhere(inboxScopeWhere(user, "ALL"), fila);

        expect(enMemoria, "canViewInboxContact").toBe(esperado);
        expect(porQuery, "inboxScopeWhere evaluado a mano").toBe(esperado);
        expect(enMemoria, "las dos definiciones divergieron").toBe(porQuery);
      });
    });
  }
});

describe("inboxScopeWhere", () => {
  it("vista completa → undefined (no se filtra nada)", () => {
    for (const rol of ["ADMIN", "DIRECTOR", "GERENTE"]) {
      expect(inboxScopeWhere({ id: "x", role: rol }, "ALL")).toBeUndefined();
    }
  });

  it("asesor → suyos + sin asignar, sin término de equipo", () => {
    expect(inboxScopeWhere({ id: "ase-1", role: "ASESOR_SR" }, "ALL")).toEqual({
      OR: [{ assignedToId: "ase-1" }, { assignedToId: null }],
    });
  });

  it("TEAM_LEADER → suma el término de sus reportes directos", () => {
    expect(inboxScopeWhere({ id: TL_ID, role: "TEAM_LEADER" }, "ALL")).toEqual({
      OR: [
        { assignedToId: TL_ID },
        { assignedToId: null },
        { assignedTo: { is: { teamLeaderId: TL_ID } } },
      ],
    });
  });

  it("un rol sin poder de dueño (HOSTESS) sigue viendo suyos + libres, no equipo", () => {
    expect(inboxScopeWhere({ id: "h-1", role: "HOSTESS" }, "ALL")).toEqual({
      OR: [{ assignedToId: "h-1" }, { assignedToId: null }],
    });
  });
});

describe("canViewInboxContact", () => {
  it("TL sin el dato de assignedTo cargado falla CERRADO (no abierto)", () => {
    // Si el llamador olvida traer assignedTo.teamLeaderId, el hilo de un reporte se ve
    // como ajeno (404) — nunca al revés.
    expect(canViewInboxContact({ assignedToId: "rep-1" }, USUARIOS.TEAM_LEADER, "ALL")).toBe(false);
  });

  it("un asesor NO hereda alcance por compartir jefe con el dueño", () => {
    const compa = { assignedToId: "rep-2", assignedTo: { teamLeaderId: TL_ID } };
    expect(canViewInboxContact(compa, { id: "rep-1", role: "ASESOR" }, "ALL")).toBe(false);
  });
});

// ── Marcas (entrega 2, 2026-10-12) ──────────────────────────────────────────────────────
// El filtro de marca va con AND encima del alcance por rol, también para la vista completa
// y para la cola sin asignar. Evaluador manual extendido: AND, OR, assignedToId, el término
// de equipo del TL y los dos términos de marca (some/none). Lo que no reconoce LANZA.
type FilaConMarca = FilaContacto & { brands: { brandId: string }[] };

function evalContacto(where: Prisma.ContactWhereInput | undefined, fila: FilaConMarca): boolean {
  if (where === undefined) return true;
  const w = where as Record<string, unknown>;
  const claves = Object.keys(w);
  if (claves.length !== 1) throw new Error(`se esperaba una sola clave: ${JSON.stringify(where)}`);
  if (Array.isArray(w.AND)) return (w.AND as Prisma.ContactWhereInput[]).every((x) => evalContacto(x, fila));
  if (Array.isArray(w.OR)) return (w.OR as Prisma.ContactWhereInput[]).some((x) => evalContacto(x, fila));
  if ("assignedToId" in w) return fila.assignedToId === w.assignedToId;
  if ("assignedTo" in w) {
    const is = (w.assignedTo as { is?: { teamLeaderId?: string } }).is;
    if (!is || typeof is.teamLeaderId !== "string") throw new Error("relación no soportada");
    return fila.assignedTo !== null && fila.assignedTo.teamLeaderId === is.teamLeaderId;
  }
  if ("brands" in w) {
    const b = w.brands as { some?: { brandId: { in: string[] } }; none?: object };
    if (b.some) return fila.brands.some((x) => b.some!.brandId.in.includes(x.brandId));
    if (b.none && Object.keys(b.none).length === 0) return fila.brands.length === 0;
  }
  throw new Error(`término no soportado: ${JSON.stringify(where)}`);
}

const DEF = "b-def";
const YAX = "b-yax";
const SOLO_PROPYTE: VisibleBrands = { brandIds: [DEF], includesDefault: true };
const CON_YAXNAH: VisibleBrands = { brandIds: [DEF, YAX], includesDefault: true };

describe("inbox × marcas — cola sin asignar", () => {
  const yaxLibre: FilaConMarca = { assignedToId: null, assignedTo: null, brands: [{ brandId: YAX }] };
  const propyteLibre: FilaConMarca = { assignedToId: null, assignedTo: null, brands: [] };

  for (const [nombre, user] of Object.entries(USUARIOS)) {
    if (nombre === "ADMIN") continue;
    it(`${nombre} SIN Yaxnáh: el hilo libre de Yaxnáh NO aparece (lista y detalle)`, () => {
      expect(evalContacto(inboxScopeWhere(user, SOLO_PROPYTE), yaxLibre)).toBe(false);
      expect(canViewInboxContact(yaxLibre, user, SOLO_PROPYTE)).toBe(false);
      // …y el libre de Propyte sigue ahí.
      expect(evalContacto(inboxScopeWhere(user, SOLO_PROPYTE), propyteLibre)).toBe(true);
      expect(canViewInboxContact(propyteLibre, user, SOLO_PROPYTE)).toBe(true);
    });

    it(`${nombre} CON Yaxnáh: el hilo libre de Yaxnáh sí aparece`, () => {
      expect(evalContacto(inboxScopeWhere(user, CON_YAXNAH), yaxLibre)).toBe(true);
      expect(canViewInboxContact(yaxLibre, user, CON_YAXNAH)).toBe(true);
    });
  }

  it("ADMIN (ALL) ve el hilo libre de Yaxnáh", () => {
    expect(inboxScopeWhere(USUARIOS.ADMIN, "ALL")).toBeUndefined();
    expect(canViewInboxContact(yaxLibre, USUARIOS.ADMIN, "ALL")).toBe(true);
  });
});

describe("inbox × marcas — la marca nunca amplía el alcance por rol", () => {
  it("un asesor CON Yaxnáh no ve el hilo de Yaxnáh de OTRO asesor", () => {
    const ajenoYax: FilaConMarca = { assignedToId: "extra-1", assignedTo: { teamLeaderId: null }, brands: [{ brandId: YAX }] };
    const ase = USUARIOS.ASESOR_SR;
    expect(evalContacto(inboxScopeWhere(ase, CON_YAXNAH), ajenoYax)).toBe(false);
    expect(canViewInboxContact(ajenoYax, ase, CON_YAXNAH)).toBe(false);
  });

  it("lo asignado a uno se ve aunque sea de una marca que no tiene", () => {
    const ase = USUARIOS.ASESOR_SR;
    const mioYax: FilaConMarca = { assignedToId: ase.id, assignedTo: { teamLeaderId: null }, brands: [{ brandId: YAX }] };
    expect(evalContacto(inboxScopeWhere(ase, SOLO_PROPYTE), mioYax)).toBe(true);
    expect(canViewInboxContact(mioYax, ase, SOLO_PROPYTE)).toBe(true);
  });

  it("forma: asesor → AND [alcance por rol, marcas]; vista completa → solo marcas", () => {
    expect(inboxScopeWhere(USUARIOS.ASESOR_SR, SOLO_PROPYTE)).toEqual({
      AND: [
        { OR: [{ assignedToId: "ase-1" }, { assignedToId: null }] },
        {
          OR: [
            { assignedToId: "ase-1" },
            { brands: { some: { brandId: { in: [DEF] } } } },
            { brands: { none: {} } },
          ],
        },
      ],
    });
    expect(inboxScopeWhere(USUARIOS.GERENTE, SOLO_PROPYTE)).toEqual({
      OR: [
        { assignedToId: "ger-1" },
        { brands: { some: { brandId: { in: [DEF] } } } },
        { brands: { none: {} } },
      ],
    });
  });

  it("detalle sin las marcas del contacto cargadas → falla cerrado", () => {
    expect(canViewInboxContact({ assignedToId: null }, USUARIOS.GERENTE, SOLO_PROPYTE)).toBe(false);
  });
});

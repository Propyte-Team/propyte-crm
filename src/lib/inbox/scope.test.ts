// src/lib/inbox/scope.test.ts
import { describe, it, expect } from "vitest";
import type { Prisma } from "@prisma/client";
import { inboxScopeWhere, canViewInboxContact, type InboxScopeUser } from "./scope";

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
        const enMemoria = canViewInboxContact(fila, user);
        const porQuery = matchesWhere(inboxScopeWhere(user), fila);

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
      expect(inboxScopeWhere({ id: "x", role: rol })).toBeUndefined();
    }
  });

  it("asesor → suyos + sin asignar, sin término de equipo", () => {
    expect(inboxScopeWhere({ id: "ase-1", role: "ASESOR_SR" })).toEqual({
      OR: [{ assignedToId: "ase-1" }, { assignedToId: null }],
    });
  });

  it("TEAM_LEADER → suma el término de sus reportes directos", () => {
    expect(inboxScopeWhere({ id: TL_ID, role: "TEAM_LEADER" })).toEqual({
      OR: [
        { assignedToId: TL_ID },
        { assignedToId: null },
        { assignedTo: { is: { teamLeaderId: TL_ID } } },
      ],
    });
  });

  it("un rol sin poder de dueño (HOSTESS) sigue viendo suyos + libres, no equipo", () => {
    expect(inboxScopeWhere({ id: "h-1", role: "HOSTESS" })).toEqual({
      OR: [{ assignedToId: "h-1" }, { assignedToId: null }],
    });
  });
});

describe("canViewInboxContact", () => {
  it("TL sin el dato de assignedTo cargado falla CERRADO (no abierto)", () => {
    // Si el llamador olvida traer assignedTo.teamLeaderId, el hilo de un reporte se ve
    // como ajeno (404) — nunca al revés.
    expect(canViewInboxContact({ assignedToId: "rep-1" }, USUARIOS.TEAM_LEADER)).toBe(false);
  });

  it("un asesor NO hereda alcance por compartir jefe con el dueño", () => {
    const compa = { assignedToId: "rep-2", assignedTo: { teamLeaderId: TL_ID } };
    expect(canViewInboxContact(compa, { id: "rep-1", role: "ASESOR" })).toBe(false);
  });
});

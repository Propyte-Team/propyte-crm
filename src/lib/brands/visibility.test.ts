// Visibilidad por marca (entrega 2, 2026-10-12). Módulo puro: sin DB.
import { describe, it, expect } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  resolveVisibleBrandIds,
  contactBrandVisibilityWhere,
  dealBrandVisibilityWhere,
  activityBrandVisibilityWhere,
  canSeeContactBrand,
  canSeeDealBrand,
  countVisibleUsersByBrand,
  type VisibleBrands,
  type UserBrandAccessRow,
} from "./visibility";

const DEF = "b-def";
const YAX = "b-yax";
const AVI = "b-avi";

const vivo = (brandId: string, isDefault = false): UserBrandAccessRow => ({
  brandId,
  brand: { isDefault, deletedAt: null },
});
const borrado = (brandId: string): UserBrandAccessRow => ({
  brandId,
  brand: { isDefault: false, deletedAt: new Date("2026-10-01") },
});

describe("resolveVisibleBrandIds", () => {
  it("ADMIN → ALL, sin importar sus filas", () => {
    expect(resolveVisibleBrandIds({ role: "ADMIN" }, [], DEF)).toBe("ALL");
    expect(resolveVisibleBrandIds({ role: "ADMIN" }, [vivo(YAX)], DEF)).toBe("ALL");
  });

  it("cualquier otro rol (DIRECTOR incluido) se filtra: sin filas → solo la predeterminada", () => {
    for (const role of ["DIRECTOR", "GERENTE", "TEAM_LEADER", "ASESOR_SR", "MARKETING", "HOSTESS"]) {
      expect(resolveVisibleBrandIds({ role }, [], DEF)).toEqual({ brandIds: [DEF], includesDefault: true });
    }
  });

  it("sin filas y sin poder leer la predeterminada → sigue viendo los contactos sin filas (no se cae Propyte)", () => {
    expect(resolveVisibleBrandIds({ role: "GERENTE" }, [], null)).toEqual({ brandIds: [], includesDefault: true });
  });

  it("conjunto explícito con la predeterminada → esas marcas + los contactos sin filas", () => {
    expect(resolveVisibleBrandIds({ role: "GERENTE" }, [vivo(DEF, true), vivo(YAX)], DEF)).toEqual({
      brandIds: [DEF, YAX],
      includesDefault: true,
    });
  });

  it("conjunto explícito SIN la predeterminada → solo esas marcas (Propyte apagado)", () => {
    expect(resolveVisibleBrandIds({ role: "ASESOR" }, [vivo(YAX)], DEF)).toEqual({
      brandIds: [YAX],
      includesDefault: false,
    });
  });

  it("ignora marcas borradas (soft delete) del conjunto explícito", () => {
    expect(resolveVisibleBrandIds({ role: "GERENTE" }, [vivo(DEF, true), borrado(AVI)], DEF)).toEqual({
      brandIds: [DEF],
      includesDefault: true,
    });
  });

  it("filas que SOLO apuntan a marcas borradas → conjunto vacío (no vuelve a la predeterminada)", () => {
    // Tener filas = el admin ya eligió. Que su única marca se haya borrado no le devuelve Propyte.
    expect(resolveVisibleBrandIds({ role: "GERENTE" }, [borrado(YAX)], DEF)).toEqual({
      brandIds: [],
      includesDefault: false,
    });
  });

  it("la predeterminada se reconoce por isDefault aunque no se haya podido leer su id", () => {
    expect(resolveVisibleBrandIds({ role: "GERENTE" }, [vivo(DEF, true)], null)).toEqual({
      brandIds: [DEF],
      includesDefault: true,
    });
  });
});

describe("contactBrandVisibilityWhere", () => {
  const user = { id: "u1" };

  it("ALL → undefined (no hay nada que filtrar)", () => {
    expect(contactBrandVisibilityWhere(user, "ALL")).toBeUndefined();
  });

  it("con la predeterminada: asignados a mí + marcas visibles + contactos sin filas", () => {
    expect(contactBrandVisibilityWhere(user, { brandIds: [DEF, YAX], includesDefault: true })).toEqual({
      OR: [
        { assignedToId: "u1" },
        { brands: { some: { brandId: { in: [DEF, YAX] } } } },
        { brands: { none: {} } },
      ],
    });
  });

  it("sin la predeterminada: NO incluye los contactos sin filas", () => {
    expect(contactBrandVisibilityWhere(user, { brandIds: [YAX], includesDefault: false })).toEqual({
      OR: [{ assignedToId: "u1" }, { brands: { some: { brandId: { in: [YAX] } } } }],
    });
  });

  it("conjunto vacío → solo lo asignado (nunca un `in: []` suelto)", () => {
    expect(contactBrandVisibilityWhere(user, { brandIds: [], includesDefault: false })).toEqual({
      OR: [{ assignedToId: "u1" }],
    });
  });
});

describe("dealBrandVisibilityWhere", () => {
  it("ALL → undefined", () => {
    expect(dealBrandVisibilityWhere({ id: "u1" }, "ALL")).toBeUndefined();
  });

  it("negocio asignado a mí, o cuyo contacto veo por marca", () => {
    expect(dealBrandVisibilityWhere({ id: "u1" }, { brandIds: [DEF], includesDefault: true })).toEqual({
      OR: [
        { assignedToId: "u1" },
        {
          contact: {
            OR: [
              { assignedToId: "u1" },
              { brands: { some: { brandId: { in: [DEF] } } } },
              { brands: { none: {} } },
            ],
          },
        },
      ],
    });
  });
});

describe("activityBrandVisibilityWhere (entrega 3: tableros y reportes)", () => {
  it("ALL → undefined (ADMIN no se filtra)", () => {
    expect(activityBrandVisibilityWhere({ id: "u1" }, "ALL")).toBeUndefined();
  });

  it("por su contacto; sin contacto, por su negocio; sin ninguno de los dos, se ve", () => {
    const visible: VisibleBrands = { brandIds: [DEF], includesDefault: true };
    const contacto = {
      OR: [{ assignedToId: "u1" }, { brands: { some: { brandId: { in: [DEF] } } } }, { brands: { none: {} } }],
    };
    expect(activityBrandVisibilityWhere({ id: "u1" }, visible)).toEqual({
      OR: [
        { contact: { is: contacto } },
        { contactId: null, deal: { is: { OR: [{ assignedToId: "u1" }, { contact: contacto }] } } },
        { contactId: null, dealId: null },
      ],
    });
  });
});

// ── Paridad where ↔ chequeo en memoria ──────────────────────────────────────────────────
// Evaluador MANUAL del where de Prisma sobre un contacto en memoria (mismo criterio que
// src/lib/inbox/scope.test.ts): no llama a canSeeContactBrand, así la paridad no es una
// tautología. Un término desconocido LANZA en vez de aprobarse sin mirar.
type Fila = { assignedToId: string | null; brands: { brandId: string }[] };

function matchesBrandWhere(where: Prisma.ContactWhereInput | undefined, fila: Fila): boolean {
  if (where === undefined) return true;
  if (!Array.isArray(where.OR)) throw new Error("se esperaba un OR");
  return where.OR.some((t) => {
    const term = t as {
      assignedToId?: string;
      brands?: { some?: { brandId: { in: string[] } }; none?: Record<string, never> };
    };
    if (term.assignedToId !== undefined) return fila.assignedToId === term.assignedToId;
    if (term.brands?.some) return fila.brands.some((b) => term.brands!.some!.brandId.in.includes(b.brandId));
    if (term.brands?.none) {
      if (Object.keys(term.brands.none).length > 0) throw new Error("none con filtro no soportado");
      return fila.brands.length === 0;
    }
    throw new Error(`término no soportado: ${JSON.stringify(t)}`);
  });
}

const ME = "u1";
const CONTACTOS: Record<string, Fila> = {
  "sin filas (Propyte), de otro": { assignedToId: "otro", brands: [] },
  "sin filas, sin asignar": { assignedToId: null, brands: [] },
  "Yaxnáh, sin asignar": { assignedToId: null, brands: [{ brandId: YAX }] },
  "Yaxnáh, asignado a mí": { assignedToId: ME, brands: [{ brandId: YAX }] },
  "Propyte + Yaxnáh (filas explícitas)": { assignedToId: "otro", brands: [{ brandId: DEF }, { brandId: YAX }] },
  "Avica, de otro": { assignedToId: "otro", brands: [{ brandId: AVI }] },
};

const VISIBLES: Record<string, VisibleBrands> = {
  "ALL (admin)": "ALL",
  "solo Propyte (sin filas)": { brandIds: [DEF], includesDefault: true },
  "solo Yaxnáh": { brandIds: [YAX], includesDefault: false },
  "Propyte + Yaxnáh": { brandIds: [DEF, YAX], includesDefault: true },
};

// [sin filas de otro, sin filas libre, Yaxnáh libre, Yaxnáh mío, Propyte+Yaxnáh, Avica]
const ESPERADO: Record<string, boolean[]> = {
  "ALL (admin)": [true, true, true, true, true, true],
  "solo Propyte (sin filas)": [true, true, false, true, true, false],
  "solo Yaxnáh": [false, false, true, true, true, false],
  "Propyte + Yaxnáh": [true, true, true, true, true, false],
};

describe("visibilidad por marca — paridad where ↔ chequeo en memoria", () => {
  for (const [nombreVis, visible] of Object.entries(VISIBLES)) {
    Object.entries(CONTACTOS).forEach(([nombreContacto, fila], i) => {
      const esperado = ESPERADO[nombreVis][i];
      it(`${nombreVis} × ${nombreContacto} → ${esperado ? "ve" : "NO ve"}`, () => {
        const enMemoria = canSeeContactBrand(fila, { id: ME }, visible);
        const porQuery = matchesBrandWhere(contactBrandVisibilityWhere({ id: ME }, visible), fila);
        expect(enMemoria, "canSeeContactBrand").toBe(esperado);
        expect(porQuery, "contactBrandVisibilityWhere evaluado a mano").toBe(esperado);
      });
    });
  }
});

describe("canSeeContactBrand", () => {
  it("si el llamador no trajo las marcas del contacto, falla CERRADO (salvo lo asignado a mí)", () => {
    const visible: VisibleBrands = { brandIds: [DEF], includesDefault: true };
    expect(canSeeContactBrand({ assignedToId: "otro" }, { id: ME }, visible)).toBe(false);
    expect(canSeeContactBrand({ assignedToId: ME }, { id: ME }, visible)).toBe(true);
  });

  it("ALL no necesita las marcas del contacto", () => {
    expect(canSeeContactBrand({ assignedToId: "otro" }, { id: ME }, "ALL")).toBe(true);
  });
});

describe("canSeeDealBrand", () => {
  const soloPropyte: VisibleBrands = { brandIds: [DEF], includesDefault: true };
  const yaxDeOtro = { assignedToId: "otro", brands: [{ brandId: YAX }] };

  it("negocio asignado a mí → lo veo aunque el contacto sea de otra marca y de otro asesor", () => {
    expect(canSeeDealBrand({ assignedToId: ME, contact: yaxDeOtro }, { id: ME }, soloPropyte)).toBe(true);
  });

  it("negocio ajeno de un contacto de una marca que no tengo → NO", () => {
    expect(canSeeDealBrand({ assignedToId: "otro", contact: yaxDeOtro }, { id: ME }, soloPropyte)).toBe(false);
  });

  it("negocio ajeno de un contacto sin filas → sí (es de Propyte)", () => {
    expect(
      canSeeDealBrand({ assignedToId: "otro", contact: { assignedToId: "otro", brands: [] } }, { id: ME }, soloPropyte),
    ).toBe(true);
  });

  it("sin el contacto cargado → falla cerrado", () => {
    expect(canSeeDealBrand({ assignedToId: "otro", contact: null }, { id: ME }, soloPropyte)).toBe(false);
  });
});

describe("countVisibleUsersByBrand", () => {
  const brands = [
    { id: DEF, isDefault: true },
    { id: YAX, isDefault: false },
    { id: AVI, isDefault: false },
  ];

  it("ADMIN cuenta en todas; sin filas solo en la predeterminada; explícito según sus filas vivas", () => {
    const users = [
      { role: "ADMIN", brandAccess: [] },
      { role: "ASESOR", brandAccess: [] },
      { role: "GERENTE", brandAccess: [vivo(DEF, true), vivo(YAX)] },
      { role: "DIRECTOR", brandAccess: [vivo(YAX), borrado(AVI)] },
    ];
    expect(countVisibleUsersByBrand(brands, users)).toEqual({ [DEF]: 3, [YAX]: 3, [AVI]: 1 });
  });

  it("sin usuarios → ceros", () => {
    expect(countVisibleUsersByBrand(brands, [])).toEqual({ [DEF]: 0, [YAX]: 0, [AVI]: 0 });
  });
});

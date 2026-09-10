import { describe, it, expect, vi, beforeEach } from "vitest";

// Tarjeta #759 — el IDOR que la #711 dejó abierto en el GET.
//
// La #711 («Control de acceso a nivel de objeto en cotizaciones, documentos, parcialidades,
// shortlists, records y links») puso `puedeTocarRecord` en el POST y en el DELETE de este
// mismo archivo, y se dejó el GET. Cualquier usuario autenticado ponía el id de un contacto
// o negocio ajeno en la URL y recibía sus vínculos con los nombres YA RESUELTOS.
//
// Este archivo no existía: el endpoint entero estaba sin pruebas, que es parte de por qué el
// hueco sobrevivió a la tarjeta que venía a cerrarlo.
//
// Las tres primeras pruebas fallan contra el GET anterior al arreglo.

const recordLinkFindMany = vi.fn();
const contactFindMany = vi.fn();
const dealFindMany = vi.fn();
const puedeTocarRecord = vi.fn();

vi.mock("@/lib/db", () => ({
  default: {
    recordLink: { findMany: (...a: unknown[]) => recordLinkFindMany(...a) },
    contact: { findMany: (...a: unknown[]) => contactFindMany(...a) },
    deal: { findMany: (...a: unknown[]) => dealFindMany(...a) },
    user: { findMany: vi.fn(async () => []) },
    customRecord: { findMany: vi.fn(async () => []) },
  },
}));

const sesion: { user: { id: string; role: string; plaza: string } | undefined } = {
  user: { id: "ase-1", role: "ASESOR", plaza: "PDC" },
};
vi.mock("@/lib/auth/session", () => ({ getServerSession: async () => sesion }));
vi.mock("@/lib/rbac/record-access", () => ({
  puedeTocarRecord: (...a: unknown[]) => puedeTocarRecord(...a),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const DEAL_AJENO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function pedir(qs: string) {
  return new NextRequest(`https://crm.propyte.com/api/links?${qs}`);
}

/** Un vínculo cualquiera, para que `resolveNames` tenga algo que resolver. */
function unVinculo() {
  return [
    {
      id: "l1",
      fromObject: "deal",
      fromId: DEAL_AJENO,
      toObject: "contact",
      toId: "c-9",
      relationship: { name: "rel", relatedListLabel: "Rel" },
      label: null,
      createdAt: new Date("2026-09-10T00:00:00Z"),
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  sesion.user = { id: "ase-1", role: "ASESOR", plaza: "PDC" };
  recordLinkFindMany.mockResolvedValue(unVinculo());
  contactFindMany.mockResolvedValue([{ id: "c-9", firstName: "Ana", lastName: "Pérez" }]);
  dealFindMany.mockResolvedValue([]);
  puedeTocarRecord.mockResolvedValue(true);
});

describe("GET /api/links — el acceso se comprueba (#759)", () => {
  it("sin acceso: 404 y NO se consulta la tabla de vínculos", async () => {
    puedeTocarRecord.mockResolvedValue(false);

    const res = await GET(pedir(`object=deal&id=${DEAL_AJENO}`));

    expect(res.status).toBe(404);
    // Lo que de verdad importa no es el código: es que la consulta no llegó a correr, así
    // que no hay nada que se pueda haber filtrado por el camino.
    expect(recordLinkFindMany).not.toHaveBeenCalled();
    expect(dealFindMany).not.toHaveBeenCalled();
    expect(contactFindMany).not.toHaveBeenCalled();
  });

  it("responde 404 y no 403, para no confirmar que el record existe", async () => {
    // Un 403 sobre un id ajeno dice «existe pero no es tuyo», que es media respuesta
    // gratis: permite enumerar ids probando. El resto de superficies de la #711 usan el
    // mismo criterio.
    puedeTocarRecord.mockResolvedValue(false);

    const res = await GET(pedir(`object=deal&id=${DEAL_AJENO}`));
    const cuerpo = await res.json();

    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
    // Y el mensaje tampoco lo distingue.
    expect(JSON.stringify(cuerpo)).not.toMatch(/permiso|prohibid|forbidden/i);
  });

  it("pide permiso de VER, no de editar", async () => {
    // Marketing y el desarrollador externo tienen lectura y no escritura desde la #711. Si
    // aquí se pidiera "editar", se les cerraría una lectura que sí les corresponde — un
    // arreglo de seguridad que rompe un permiso legítimo se revierte, y el agujero vuelve.
    await GET(pedir(`object=deal&id=${DEAL_AJENO}`));

    expect(puedeTocarRecord).toHaveBeenCalledWith("deal", DEAL_AJENO, sesion.user, "ver");
  });

  it("con acceso: 200 y sí consulta", async () => {
    const res = await GET(pedir(`object=deal&id=${DEAL_AJENO}`));

    expect(res.status).toBe(200);
    expect(recordLinkFindMany).toHaveBeenCalledOnce();
  });

  it("se comprueba ANTES de consultar, no después de traer las filas", async () => {
    // Si el control corriera después del `findMany`, los datos ya habrían salido de la base
    // y bastaría un `console.log` mal puesto o un error a medias para exponerlos. El orden
    // es parte del arreglo.
    const orden: string[] = [];
    puedeTocarRecord.mockImplementation(async () => {
      orden.push("permiso");
      return true;
    });
    recordLinkFindMany.mockImplementation(async () => {
      orden.push("consulta");
      return unVinculo();
    });

    await GET(pedir(`object=deal&id=${DEAL_AJENO}`));

    expect(orden).toEqual(["permiso", "consulta"]);
  });
});

describe("GET /api/links — lo que se filtraba, para que se vea por qué importa (#759)", () => {
  it("el nombre de un negocio lleva su VALOR ESTIMADO dentro", async () => {
    // Esta prueba no vigila el arreglo: documenta el daño. `resolveNames` formatea un deal
    // como "Nombre Apellido — $4,500,000", así que la fuga no era de identificadores
    // opacos: era la cartera y los montos de otro asesor en texto legible. Si algún día
    // alguien se plantea relajar el control de arriba, esto es lo que estaría abriendo.
    recordLinkFindMany.mockResolvedValue([
      {
        id: "l1",
        fromObject: "contact",
        fromId: "c-1",
        toObject: "deal",
        toId: "d-9",
        relationship: { name: "rel", relatedListLabel: "Rel" },
        label: null,
        createdAt: new Date("2026-09-10T00:00:00Z"),
      },
    ]);
    dealFindMany.mockResolvedValue([
      { id: "d-9", contact: { firstName: "Ana", lastName: "Pérez" }, estimatedValue: 4_500_000 },
    ]);

    const res = await GET(pedir("object=contact&id=c-1"));
    const cuerpo = JSON.stringify(await res.json());

    expect(res.status).toBe(200);
    expect(cuerpo).toContain("Ana Pérez");
    expect(cuerpo).toMatch(/4[.,]500[.,]000/);
  });
});

describe("GET /api/links — las puertas que ya estaban (#759)", () => {
  it("sin sesión: 401 y no se comprueba nada más", async () => {
    sesion.user = undefined;

    const res = await GET(pedir(`object=deal&id=${DEAL_AJENO}`));

    expect(res.status).toBe(401);
    expect(puedeTocarRecord).not.toHaveBeenCalled();
    expect(recordLinkFindMany).not.toHaveBeenCalled();
  });

  it("sin object o sin id: 400 antes de preguntar por permisos", async () => {
    // El orden importa por coste, no por seguridad: `puedeTocarRecord` consulta la base.
    expect((await GET(pedir("object=deal"))).status).toBe(400);
    expect((await GET(pedir(`id=${DEAL_AJENO}`))).status).toBe(400);
    expect((await GET(pedir(""))).status).toBe(400);

    expect(puedeTocarRecord).not.toHaveBeenCalled();
    expect(recordLinkFindMany).not.toHaveBeenCalled();
  });
});

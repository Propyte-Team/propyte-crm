// «Leads huérfanos» (2026-10-12, entrega 3 de marcas): roles y forma de las consultas (a), (b), (c).
import { describe, it, expect } from "vitest";
import { UserRole } from "@prisma/client";
import {
  ORPHAN_LEADS_ROLES,
  canSeeOrphanLeads,
  unownedContactsWhere,
  technicalOwnerContactsWhere,
  unregisteredAccountNoteWhere,
  latestNotesOnly,
} from "./orphans";
import { PROVISIONAL_COMMENT_LEAD } from "./real-leads";
import { userMenuItems } from "@/components/layout/nav-config";
import type { VisibleBrands } from "@/lib/brands/visibility";

const SOLO_PROPYTE: VisibleBrands = { brandIds: ["b-def"], includesDefault: true };
const visibilidad = (u: string) => ({
  OR: [{ assignedToId: u }, { brands: { some: { brandId: { in: ["b-def"] } } } }, { brands: { none: {} } }],
});

describe("roles", () => {
  it("los mismos que ven Conexiones (menú del nombre)", () => {
    const conexiones = userMenuItems.find((i) => i.href === "/conexiones")!;
    expect([...ORPHAN_LEADS_ROLES].sort()).toEqual([...conexiones.roles].sort());
  });

  it("permitidos: ADMIN, DIRECTOR, GERENTE, MARKETING", () => {
    for (const r of ["ADMIN", "DIRECTOR", "GERENTE", "MARKETING"]) expect(canSeeOrphanLeads(r)).toBe(true);
  });

  it("denegados: todos los demás roles del enum, vacío o desconocido", () => {
    const permitidos = new Set<string>(ORPHAN_LEADS_ROLES);
    for (const r of Object.values(UserRole)) {
      if (!permitidos.has(r)) expect(canSeeOrphanLeads(r), r).toBe(false);
    }
    expect(canSeeOrphanLeads(null)).toBe(false);
    expect(canSeeOrphanLeads("")).toBe(false);
    expect(canSeeOrphanLeads("admin")).toBe(false);
  });
});

describe("(a) sin dueño", () => {
  it("vivo, no fusionado, sin asesor, solo leads reales, recortado por marca", () => {
    expect(unownedContactsWhere({ id: "ger-1" }, SOLO_PROPYTE)).toEqual({
      deletedAt: null,
      mergedIntoId: null,
      assignedToId: null,
      AND: [visibilidad("ger-1")],
      NOT: PROVISIONAL_COMMENT_LEAD,
    });
  });

  it("ADMIN: sin recorte de marca", () => {
    const w = unownedContactsWhere({ id: "adm-1" }, "ALL");
    expect(w.AND).toBeUndefined();
    expect(w.assignedToId).toBeNull();
  });
});

describe("(b) dueño técnico", () => {
  it("dueño con correo del dominio técnico, recortado por marca", () => {
    expect(technicalOwnerContactsWhere({ id: "mkt-1" }, SOLO_PROPYTE)).toEqual({
      deletedAt: null,
      mergedIntoId: null,
      assignedTo: { is: { email: { endsWith: ".local" } } },
      AND: [visibilidad("mkt-1")],
      NOT: PROVISIONAL_COMMENT_LEAD,
    });
  });
});

describe("(c) cuenta sin registrar", () => {
  it("notas del sistema con cualquiera de los dos textos, en hilos abiertos", () => {
    const w = unregisteredAccountNoteWhere({ id: "ger-1", role: "GERENTE" }, SOLO_PROPYTE);
    expect(w.internalNote).toBe(true);
    expect(w.sender).toBe("SYSTEM");
    expect(w.OR).toEqual([
      { body: { startsWith: "El agente no contestó: este WhatsApp llegó al número " } },
      {
        AND: [
          { body: { startsWith: "El agente no contestó: este mensaje de " } },
          { body: { contains: " llegó a la cuenta " } },
        ],
      },
    ]);
    // GERENTE tiene vista completa en la bandeja: solo la marca
    expect(w.conversation).toEqual({
      is: {
        status: { not: "CLOSED" },
        contact: { deletedAt: null, mergedIntoId: null, AND: [visibilidad("ger-1")] },
      },
    });
  });

  it("MARKETING: alcance de la bandeja (suyos + sin asignar) Y marca, para que el enlace abra", () => {
    const w = unregisteredAccountNoteWhere({ id: "mkt-1", role: "MARKETING" }, SOLO_PROPYTE);
    const contact = (w.conversation as { is: { contact: { AND: unknown[] } } }).is.contact;
    expect(contact.AND).toEqual([
      {
        AND: [
          { OR: [{ assignedToId: "mkt-1" }, { assignedToId: null }] },
          visibilidad("mkt-1"),
        ],
      },
    ]);
  });

  it("ADMIN: hilos abiertos de todos", () => {
    const w = unregisteredAccountNoteWhere({ id: "adm-1", role: "ADMIN" }, "ALL");
    expect(w.conversation).toEqual({
      is: { status: { not: "CLOSED" }, contact: { deletedAt: null, mergedIntoId: null } },
    });
  });
});

describe("latestNotesOnly", () => {
  it("se queda con los hilos donde la nota sigue siendo la última nota interna", () => {
    const notas = [
      { id: "n1", conversationId: "c1" },
      { id: "n2", conversationId: "c2" },
      { id: "n3", conversationId: null },
    ];
    const ultima = new Map([
      ["c1", "n1"],
      ["c2", "otra-nota-posterior"],
    ]);
    expect(latestNotesOnly(notas, ultima).map((n) => n.id)).toEqual(["n1"]);
  });
});

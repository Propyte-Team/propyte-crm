import { describe, it, expect } from "vitest";
import { puedeVerNegocio, puedeEditarNegocio } from "./deal-access";

// Tarjeta #711. El control existía pero solo en la ruta del negocio; todo lo que cuelga de
// él —cotizaciones, planes de pago, parcialidades, documentos— se conformaba con que
// hubiera sesión. Estas pruebas fijan la decisión rol por rol, que es donde vivía el bug.

const negocioDe = (assignedToId: string | null, plaza = "PDC", teamLeaderId: string | null = null) => ({
  assignedToId,
  assignedTo: { plaza, teamLeaderId },
});

const usuario = (role: string, id = "u1", plaza = "PDC") => ({ id, role, plaza });

describe("puedeVerNegocio", () => {
  it("dirección y administración ven cualquier negocio", () => {
    const ajeno = negocioDe("otro", "TULUM");
    expect(puedeVerNegocio(ajeno, usuario("ADMIN"))).toBe(true);
    expect(puedeVerNegocio(ajeno, usuario("DIRECTOR"))).toBe(true);
  });

  it("el gerente ve su plaza y no la de al lado", () => {
    expect(puedeVerNegocio(negocioDe("otro", "PDC"), usuario("GERENTE"))).toBe(true);
    expect(puedeVerNegocio(negocioDe("otro", "TULUM"), usuario("GERENTE"))).toBe(false);
  });

  it("el team leader ve lo suyo y lo de quien le reporta", () => {
    expect(puedeVerNegocio(negocioDe("u1"), usuario("TEAM_LEADER"))).toBe(true);
    expect(puedeVerNegocio(negocioDe("miembro", "PDC", "u1"), usuario("TEAM_LEADER"))).toBe(true);
    expect(puedeVerNegocio(negocioDe("ajeno", "PDC", "otro-tl"), usuario("TEAM_LEADER"))).toBe(false);
  });

  it("el asesor ve solo lo suyo", () => {
    for (const rol of ["ASESOR", "ASESOR_SR", "ASESOR_JR", "BROKER"]) {
      expect(puedeVerNegocio(negocioDe("u1"), usuario(rol))).toBe(true);
      expect(puedeVerNegocio(negocioDe("otro"), usuario(rol))).toBe(false);
    }
  });

  it("un negocio sin asesor asignado no es de nadie", () => {
    expect(puedeVerNegocio(negocioDe(null), usuario("ASESOR"))).toBe(false);
    expect(puedeVerNegocio(negocioDe(null), usuario("TEAM_LEADER"))).toBe(false);
    // Pero dirección sí lo ve: alguien tiene que poder rescatarlo.
    expect(puedeVerNegocio(negocioDe(null), usuario("DIRECTOR"))).toBe(true);
  });

  it("un rol desconocido no ve nada", () => {
    // El default es negar. Es lo contrario de lo que hacía /hoy, donde un rol no
    // contemplado lo veía todo.
    expect(puedeVerNegocio(negocioDe("u1"), usuario("ROL_NUEVO"))).toBe(false);
  });

  it("HOSTESS no ve negocios ajenos", () => {
    // El caso de la auditoría: una hostess iterando ids para leer documentos KYC.
    expect(puedeVerNegocio(negocioDe("otro"), usuario("HOSTESS"))).toBe(false);
  });
});

describe("puedeEditarNegocio", () => {
  it("marketing y el desarrollador externo miran pero no tocan", () => {
    const propio = negocioDe("u1");
    for (const rol of ["MARKETING", "DEVELOPER_EXT"]) {
      expect(puedeVerNegocio(propio, usuario(rol))).toBe(true);
      expect(puedeEditarNegocio(propio, usuario(rol))).toBe(false);
    }
  });

  it("quien puede ver por pertenencia también puede editar", () => {
    expect(puedeEditarNegocio(negocioDe("u1"), usuario("ASESOR"))).toBe(true);
    expect(puedeEditarNegocio(negocioDe("otro", "PDC"), usuario("GERENTE"))).toBe(true);
    expect(puedeEditarNegocio(negocioDe("otro", "TULUM"), usuario("GERENTE"))).toBe(false);
  });

  it("el orden es total → plaza → equipo → propio: un ADMIN no queda atrapado en su equipo", () => {
    // ADMIN está en los cuatro conjuntos. Si se evaluara equipo antes que total, vería
    // solo lo de su equipo — bug que este repo ya tuvo en las actividades.
    const ajeno = negocioDe("nadie-de-su-equipo", "MERIDA", "otro-tl");
    expect(puedeEditarNegocio(ajeno, usuario("ADMIN"))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { SIN_ASESOR, armarComparativa, asesoresDeGrupos, filtrarGruposPorAsesor, type ContactoComparable } from "./duplicados-comparar";

const ct = (id: string, o: Partial<ContactoComparable> = {}): ContactoComparable => ({
  id, firstName: "Ana", lastName: "Pérez", email: "ana@x.com", phone: "+5219981", createdAt: "2026-01-02T10:00:00Z",
  assignedTo: { name: "Luis" }, instagramId: null, messengerPsid: null, _count: { deals: 1, activities: 2 }, ...o,
});

const grupos = [
  { key: "1", contacts: [ct("a"), ct("b", { assignedTo: { name: "María" } })] },
  { key: "2", contacts: [ct("c", { assignedTo: null }), ct("d", { assignedTo: { name: null } })] },
  { key: "3", contacts: [ct("e", { assignedTo: { name: "Zoe" } })] },
];

describe("filtro por asesor", () => {
  it("lista los asesores presentes y avisa de los sin asesor", () => {
    expect(asesoresDeGrupos(grupos)).toEqual({ nombres: ["Luis", "María", "Zoe"], haySinAsesor: true });
    expect(asesoresDeGrupos([{ contacts: [ct("a")] }])).toEqual({ nombres: ["Luis"], haySinAsesor: false });
  });
  it("vacío devuelve todo", () => expect(filtrarGruposPorAsesor(grupos, "")).toBe(grupos));
  it("deja los grupos donde algún contacto es de ese asesor", () => {
    expect(filtrarGruposPorAsesor(grupos, "María").map((g) => g.key)).toEqual(["1"]);
    expect(filtrarGruposPorAsesor(grupos, "Zoe").map((g) => g.key)).toEqual(["3"]);
  });
  it("sin asesor", () => expect(filtrarGruposPorAsesor(grupos, SIN_ASESOR).map((g) => g.key)).toEqual(["2"]));
});

describe("armarComparativa", () => {
  it("marca solo las filas que difieren", () => {
    const filas = armarComparativa([ct("a"), ct("b", { email: null, assignedTo: { name: "María" }, _count: { deals: 3, activities: 2 } })]);
    const por = Object.fromEntries(filas.map((f) => [f.clave, f]));
    expect(por.nombre.difiere).toBe(false);
    expect(por.telefono.difiere).toBe(false);
    expect(por.correo).toMatchObject({ valores: ["ana@x.com", "—"], difiere: true });
    expect(por.asesor.difiere).toBe(true);
    expect(por.negocios).toMatchObject({ valores: ["1", "3"], difiere: true });
    expect(por.actividades.difiere).toBe(false);
  });
  it("ignora mayúsculas y espacios al comparar y muestra el canal", () => {
    const filas = armarComparativa([ct("a", { email: "ANA@x.com" }), ct("b", { email: "ana@x.com", instagramId: "ig1" })]);
    expect(filas.find((f) => f.clave === "correo")!.difiere).toBe(false);
    expect(filas.find((f) => f.clave === "canal")).toMatchObject({ valores: ["—", "Instagram"], difiere: true });
  });
});

import { describe, expect, it } from "vitest";
import {
  buscarReglaDuplicada,
  campoDeMensaje,
  CAMPOS_ACUERDO,
  construirFilaUsuario,
  leerEnteroNoNegativo,
} from "./admin-helpers";
import { ACTIVITY_AGREEMENT_DEFAULTS } from "@/lib/constants";

const reglas = [
  { id: "1", dealType: "NATIVA_CONTADO", leadSourceCategory: "PROPYTE_LEAD", role: "ASESOR_SR", percentage: 2.5 },
  { id: "2", dealType: "MACROLOTE", leadSourceCategory: "BROKER_LEAD", role: "GERENTE", percentage: 1 },
];

describe("buscarReglaDuplicada", () => {
  it("encuentra la misma combinación", () => {
    const r = buscarReglaDuplicada(reglas, {
      dealType: "NATIVA_CONTADO",
      leadSourceCategory: "PROPYTE_LEAD",
      role: "ASESOR_SR",
    });
    expect(r?.id).toBe("1");
  });
  it("no marca duplicado si difiere algún campo", () => {
    expect(
      buscarReglaDuplicada(reglas, {
        dealType: "NATIVA_CONTADO",
        leadSourceCategory: "PROPYTE_LEAD",
        role: "ASESOR_JR",
      }),
    ).toBeUndefined();
  });
  it("ignora la propia regla al editar", () => {
    expect(buscarReglaDuplicada(reglas, reglas[0], "1")).toBeUndefined();
  });
});

describe("campoDeMensaje", () => {
  it("apunta al correo", () => {
    expect(campoDeMensaje("Ya existe un usuario con este correo electrónico")).toBe("email");
  });
  it("sin campo conocido", () => {
    expect(campoDeMensaje("Acceso denegado")).toBeUndefined();
  });
});

describe("construirFilaUsuario", () => {
  const dev = {
    id: "u1",
    name: "Ana",
    email: "a@x.com",
    role: "ASESOR_SR",
    plaza: "TULUM",
    careerLevel: "SR",
    isActive: true,
  };
  it("alta: arma la fila con líder y valores por defecto", () => {
    const f = construirFilaUsuario(
      dev,
      { teamLeaderId: "t1", phone: "123", sedetusExpiry: "2027-01-02" },
      [{ id: "t1", name: "Luis" }],
    );
    expect(f.teamLeader?.name).toBe("Luis");
    expect(f.phone).toBe("123");
    expect(f._count.deals).toBe(0);
    expect(f.sedetusExpiry).toBeInstanceOf(Date);
  });
  it("edición: conserva lo que no se envió", () => {
    const previa = construirFilaUsuario(dev, { phone: "999" }, []);
    const f = construirFilaUsuario({ ...dev, name: "Ana B" }, { name: "Ana B" }, [], previa);
    expect(f.phone).toBe("999");
    expect(f.name).toBe("Ana B");
  });
  it("teamLeaderId null quita al líder", () => {
    const previa = construirFilaUsuario(dev, { teamLeaderId: "t1" }, [{ id: "t1", name: "Luis" }]);
    expect(construirFilaUsuario(dev, { teamLeaderId: null }, [], previa).teamLeader).toBeNull();
  });
});

describe("acuerdo de actividad", () => {
  it("cubre todos los defaults de constants", () => {
    expect(CAMPOS_ACUERDO.map((c) => c.key).sort()).toEqual(Object.keys(ACTIVITY_AGREEMENT_DEFAULTS).sort());
  });
  it("nunca devuelve negativos ni NaN", () => {
    expect(leerEnteroNoNegativo("-5")).toBe(0);
    expect(leerEnteroNoNegativo("")).toBe(0);
    expect(leerEnteroNoNegativo("12")).toBe(12);
  });
});

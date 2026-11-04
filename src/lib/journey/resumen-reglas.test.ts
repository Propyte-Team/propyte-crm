import { describe, expect, it } from "vitest";
import { armarResumenReglas, ordenarResumen, porcentajeFallo } from "./resumen-reglas";

const reglas = [
  { id: "a", name: "Bienvenida", isActive: true },
  { id: "b", name: "Alerta", isActive: false },
  { id: "c", name: "Sin uso", isActive: true },
];

describe("armarResumenReglas", () => {
  it("suma por estado y deja en cero las reglas sin disparos", () => {
    const r = armarResumenReglas(
      [
        { ruleId: "a", status: "DONE", n: 8 },
        { ruleId: "a", status: "FAILED", n: 2 },
        { ruleId: "a", status: "PENDING", n: 1 },
        { ruleId: "b", status: "DONE", n: 3 },
      ],
      reglas,
    );
    expect(r.find((x) => x.ruleId === "a")).toMatchObject({ disparos: 11, completadas: 8, fallidas: 2, otras: 1 });
    expect(r.find((x) => x.ruleId === "c")).toMatchObject({ disparos: 0, completadas: 0, fallidas: 0 });
  });
  it("ignora filas sin regla o de reglas borradas", () => {
    const r = armarResumenReglas([{ ruleId: null, status: "DONE", n: 5 }, { ruleId: "zzz", status: "DONE", n: 5 }], reglas);
    expect(r.every((x) => x.disparos === 0)).toBe(true);
  });
});

describe("ordenarResumen", () => {
  const base = armarResumenReglas(
    [{ ruleId: "a", status: "DONE", n: 5 }, { ruleId: "b", status: "FAILED", n: 7 }],
    reglas,
  );
  it("por disparos y por fallidas", () => {
    expect(ordenarResumen(base, "disparos")[0].ruleId).toBe("b");
    expect(ordenarResumen(base, "fallidas")[0].ruleId).toBe("b");
  });
  it("por nombre", () => {
    expect(ordenarResumen(base, "nombre").map((x) => x.nombre)).toEqual(["Alerta", "Bienvenida", "Sin uso"]);
  });
});

describe("porcentajeFallo", () => {
  it("calcula y maneja sin terminadas", () => {
    expect(porcentajeFallo({ completadas: 3, fallidas: 1 })).toBe(25);
    expect(porcentajeFallo({ completadas: 0, fallidas: 0 })).toBeNull();
  });
});

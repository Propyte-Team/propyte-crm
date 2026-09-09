import { describe, it, expect } from "vitest";

// Tarjeta #678, apartado (a). Los cotejos del 04-sep y del 07-sep lo subieron al primer
// puesto con este argumento: «es lo único que puede decir qué está pasando», porque desde
// fuera no se podía distinguir «a este lead ni se le llamó al reparto» de «se le llamó y no
// encontró a nadie» — y son arreglos distintos.
//
// Estas pruebas cubren la parte pura: dado lo que el bucle de reglas dejó anotado, cuál es
// el motivo que mejor lo explica.

import { motivoSinAsignar, explicacion, type PasoDeReparto } from "./routing-diagnostico";

const R1 = "regla-1";
const R2 = "regla-2";

describe("motivoSinAsignar — cuando ninguna regla llegó a evaluarse (#678a)", () => {
  it("sin reglas activas lo dice, y eso es configuración, no código", () => {
    // Esta es LA distinción que la #698 no podía hacer: si no hay ni una regla activa, el
    // arreglo no está en el reparto, está en el tablero de configuración.
    expect(motivoSinAsignar([], 0)).toBe("sin_reglas_activas");
  });

  it("con reglas activas pero ninguna que matchee, también lo dice", () => {
    expect(motivoSinAsignar([], 1)).toBe("ninguna_regla_matchea");
    expect(motivoSinAsignar([], 7)).toBe("ninguna_regla_matchea");
  });
});

describe("motivoSinAsignar — cuando una regla matcheó y aun así falló (#678a)", () => {
  it("devuelve el motivo tal cual si solo hay uno", () => {
    expect(motivoSinAsignar([{ reglaId: R1, motivo: "sin_plaza_resoluble" }], 1))
      .toBe("sin_plaza_resoluble");
    expect(motivoSinAsignar([{ reglaId: R1, motivo: "sin_candidatos_ruteables" }], 1))
      .toBe("sin_candidatos_ruteables");
  });

  it("«sin candidatos» gana a «sin plaza», porque señala un problema de personas", () => {
    // El orden no es arbitrario: que no haya asesores ruteables es un problema del equipo;
    // que un contacto no traiga plaza es un dato faltante de ese contacto. El primero
    // afecta a todos los leads que entren después.
    const pasos: PasoDeReparto[] = [
      { reglaId: R1, motivo: "sin_plaza_resoluble" },
      { reglaId: R2, motivo: "sin_candidatos_ruteables" },
    ];

    expect(motivoSinAsignar(pasos, 2)).toBe("sin_candidatos_ruteables");
    // Y da igual en qué orden se evaluaron las reglas.
    expect(motivoSinAsignar([...pasos].reverse(), 2)).toBe("sin_candidatos_ruteables");
  });

  it("«la estrategia no eligió» gana a todo, porque sería un defecto de código", () => {
    const pasos: PasoDeReparto[] = [
      { reglaId: R1, motivo: "sin_candidatos_ruteables" },
      { reglaId: R2, motivo: "estrategia_no_eligio" },
    ];

    expect(motivoSinAsignar(pasos, 2)).toBe("estrategia_no_eligio");
  });

  it("el número de reglas activas no cambia nada si hubo pasos anotados", () => {
    // Si una regla llegó a evaluarse, `reglasActivas` ya no explica nada.
    const pasos: PasoDeReparto[] = [{ reglaId: R1, motivo: "sin_plaza_resoluble" }];

    expect(motivoSinAsignar(pasos, 1)).toBe("sin_plaza_resoluble");
    expect(motivoSinAsignar(pasos, 99)).toBe("sin_plaza_resoluble");
  });
});

describe("explicacion — una línea legible por una persona (#678a)", () => {
  const MOTIVOS = [
    "sin_reglas_activas",
    "ninguna_regla_matchea",
    "sin_plaza_resoluble",
    "sin_candidatos_ruteables",
    "estrategia_no_eligio",
  ] as const;

  it("los cinco motivos tienen explicación, y ninguna está vacía", () => {
    for (const m of MOTIVOS) {
      expect(explicacion(m).length, `${m} sin explicación`).toBeGreaterThan(20);
    }
  });

  it("cada explicación es distinta: si dos coinciden, el log no distingue nada", () => {
    const textos = MOTIVOS.map((m) => explicacion(m));

    expect(new Set(textos).size).toBe(MOTIVOS.length);
  });

  it("la de «sin reglas activas» dice que es configuración, para no mandar a nadie al código", () => {
    expect(explicacion("sin_reglas_activas")).toContain("configuración");
  });

  it("la de «la estrategia no eligió» dice que es un defecto, para que no se archive como dato", () => {
    expect(explicacion("estrategia_no_eligio")).toContain("defecto");
  });
});

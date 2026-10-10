import { describe, it, expect } from "vitest";
import { buildAdvisorOptions } from "./advisor-options";

const ASESORES = [
  { id: "u-ia", name: "Agentes Propyte (IA)", email: "ia@propyte.com" },
  { id: "u-ana", name: "Ana Pérez", email: "ana@propyte.com" },
  { id: "u-sin-nombre", name: null, email: "sin@propyte.com" },
];

describe("buildAdvisorOptions", () => {
  it("sin usuario en sesión: las mismas opciones de siempre", () => {
    expect(buildAdvisorOptions(ASESORES)).toEqual([
      { value: "u-ia", label: "Agentes Propyte (IA)" },
      { value: "u-ana", label: "Ana Pérez" },
      { value: "u-sin-nombre", label: "sin@propyte.com" },
    ]);
    expect(buildAdvisorOptions(ASESORES, null)).toEqual(buildAdvisorOptions(ASESORES));
  });

  // 2026-10-10: quien lleva marketing (ADMIN) no aparecía en la lista de
  // asesores y no podía asignarse un lead desde la ficha.
  it("un ADMIN que no está en la lista aparece primero como '(yo)'", () => {
    const options = buildAdvisorOptions(ASESORES, { id: "u-admin", name: "Luis Flores", email: null });
    expect(options[0]).toEqual({ value: "u-admin", label: "Luis Flores (yo)" });
    expect(options.slice(1)).toEqual(buildAdvisorOptions(ASESORES));
  });

  it("si ya es asesor no se duplica", () => {
    const options = buildAdvisorOptions(ASESORES, { id: "u-ana", name: "Ana Pérez", email: null });
    expect(options.filter((o) => o.value === "u-ana")).toHaveLength(1);
    expect(options).toEqual(buildAdvisorOptions(ASESORES));
  });

  it("aparece aunque la lista de asesores todavía no cargue", () => {
    expect(buildAdvisorOptions([], { id: "u-admin", name: "Luis Flores", email: null })).toEqual([
      { value: "u-admin", label: "Luis Flores (yo)" },
    ]);
  });

  it("sin nombre usa el correo, y sin ninguno 'Asignarme a mí'", () => {
    expect(buildAdvisorOptions([], { id: "u1", name: null, email: "yo@propyte.com" })[0].label).toBe(
      "yo@propyte.com (yo)"
    );
    expect(buildAdvisorOptions([], { id: "u1", name: null, email: null })[0].label).toBe("Asignarme a mí");
  });
});

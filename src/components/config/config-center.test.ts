import { describe, it, expect } from "vitest";
import { visibleCards, resolveInitialSection } from "./config-center";

describe("visibleCards", () => {
  const cards = [
    { title: "Sin restriccion", icon: (() => null) as any, items: [] },
    { title: "Solo ADMIN/DIRECTOR", icon: (() => null) as any, items: [], roles: ["ADMIN", "DIRECTOR"] },
  ];

  it("ADMIN ve todas las cards, incluso las restringidas por roles", () => {
    const result = visibleCards(cards, "ADMIN");
    expect(result).toHaveLength(2);
  });

  it("DIRECTOR ve las cards sin restriccion y las que lo incluyen explicitamente", () => {
    const result = visibleCards(cards, "DIRECTOR");
    expect(result.map((c) => c.title)).toEqual(["Sin restriccion", "Solo ADMIN/DIRECTOR"]);
  });

  it("GERENTE no ve cards restringidas a ADMIN/DIRECTOR", () => {
    const result = visibleCards(cards, "GERENTE");
    expect(result.map((c) => c.title)).toEqual(["Sin restriccion"]);
  });

  it("cards sin `roles` siempre son visibles, sin importar el rol", () => {
    const result = visibleCards(cards, "ASESOR");
    expect(result.map((c) => c.title)).toEqual(["Sin restriccion"]);
  });
});

describe("resolveInitialSection", () => {
  it("sin param → index", () => {
    expect(resolveInitialSection(null)).toBe("index");
    expect(resolveInitialSection(undefined)).toBe("index");
  });
  it("param desconocido → index (no crashea)", () => {
    expect(resolveInitialSection("no-existe")).toBe("index");
  });
  it("param válido (ej. automation, deep-link desde Journey) → esa sección", () => {
    expect(resolveInitialSection("automation")).toBe("automation");
  });
  it("acepta cualquier SectionKey válida", () => {
    expect(resolveInitialSection("teams")).toBe("teams");
    expect(resolveInitialSection("agents")).toBe("agents");
  });
});

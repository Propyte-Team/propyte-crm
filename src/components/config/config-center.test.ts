import { describe, it, expect } from "vitest";
import { visibleCards, resolveInitialSection, CONFIG_GROUPS } from "./config-center";

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
    expect(resolveInitialSection("fields")).toBe("fields");
  });
  // 2026-10-09: "Agentes automáticos" se quitó del panel. Un enlace viejo con
  // ?section=agents debe caer al índice, no romper la página.
  it("?section=agents (enlace viejo de Agentes automáticos) → index", () => {
    expect(resolveInitialSection("agents")).toBe("index");
  });
});

// 2026-10-09: se quitó la tarjeta "Agentes automáticos" (Agent Studio): sin uso
// (2 agentes inactivos, 0 corridas). "Agentes conversacionales" (BotAgentProfile)
// es la opción que sí se usa y debe seguir presente.
describe("CONFIG_GROUPS", () => {
  const allCards = CONFIG_GROUPS.flatMap((g) => g.cards);

  it("ninguna tarjeta se titula 'Agentes automáticos'", () => {
    expect(allCards.map((c) => c.title)).not.toContain("Agentes automáticos");
  });

  it("ninguna tarjeta abre la sección embebida 'agents'", () => {
    expect(allCards.map((c) => c.key)).not.toContain("agents");
  });

  // E1: los perfiles por tipo de cliente y las marcas siguen, con nombre de negocio.
  it("los perfiles del asistente y las marcas siguen presentes (mismo destino)", () => {
    const hrefs = allCards.map((c) => c.href);
    expect(hrefs).toContain("/admin?tab=botAgents");
    expect(hrefs).toContain("/admin?tab=botBrands");
  });

  it("los destinos de las pantallas no cambian en E1", () => {
    const hrefs = allCards.map((c) => c.href).filter(Boolean);
    for (const h of ["/settings", "/admin?tab=users", "/journey", "/duplicados", "/conexiones", "/conexiones/huerfanos", "/admin?tab=integrations"]) {
      expect(hrefs).toContain(h);
    }
    expect(allCards.map((c) => c.key).filter(Boolean).sort()).toEqual(["automation", "corefields", "fields", "teams"]);
  });

  it("ninguna tarjeta manda al inbox operativo de WhatsApp", () => {
    expect(allCards.map((c) => c.href)).not.toContain("/inbox");
    expect(allCards.map((c) => c.title)).not.toContain("WhatsApp");
  });

  it("títulos, subtítulos y grupos no contienen jerga técnica", () => {
    const jerga = /anti-sprawl|enforcement|L0-L[0-3]|8 canónicas|humano-en-loop|takeover|cloud api|\.local|push-only|presets/i;
    const textos = CONFIG_GROUPS.flatMap((g) => [g.title, ...g.cards.flatMap((c) => [c.title, ...c.items])]);
    for (const t of textos) expect(t).not.toMatch(jerga);
  });

  it("Duplicados y Leads sin asesor viven en 'Calidad de datos' para gerencia", () => {
    const grupo = CONFIG_GROUPS.find((g) => g.title === "Calidad de datos");
    expect(grupo?.cards.map((c) => c.href)).toEqual(["/duplicados", "/conexiones/huerfanos"]);
    for (const c of grupo!.cards) expect([...c.roles!].sort()).toEqual(["ADMIN", "DIRECTOR", "GERENTE"]);
    const visiblesGerente = visibleCards(allCards, "GERENTE").map((c) => c.href);
    expect(visiblesGerente).toContain("/duplicados");
    expect(visibleCards(allCards, "ASESOR").map((c) => c.href)).not.toContain("/duplicados");
  });

  it("toda tarjeta que no es 'Mi perfil' declara roles", () => {
    for (const c of allCards) if (c.href !== "/settings") expect(c.roles?.length).toBeGreaterThan(0);
  });

  it("un ASESOR solo ve 'Mi perfil'; ADMIN ve todas", () => {
    expect(visibleCards(allCards, "ASESOR").map((c) => c.href)).toEqual(["/settings"]);
    expect(visibleCards(allCards, "ADMIN")).toHaveLength(allCards.length);
  });
});

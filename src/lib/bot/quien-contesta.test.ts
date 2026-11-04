import { describe, it, expect } from "vitest";
import { resolverQuienContesta, textoHereda } from "./quien-contesta";

const botConfig = { botEnabled: true, tonePreset: "PROFESIONAL_CALIDO", autonomyLevel: "L2", activePlaybookId: "pb-g" };
const playbooks = [
  { id: "pb-g", name: "General" },
  { id: "pb-m", name: "Guion Nativa" },
  { id: "pb-a", name: "Guion Brokers" },
];
const marcaNativa = { id: "m1", name: "Nativa", isDefault: false, botEnabled: true, tonePreset: "EJECUTIVO_SOBRIO", playbookId: "pb-m" };
const marcaDefault = { id: "m0", name: "Propyte", isDefault: true, botEnabled: false, tonePreset: null, playbookId: null };

describe("resolverQuienContesta", () => {
  it("cuenta con marca: manda el estilo y el guion de la marca", () => {
    const r = resolverQuienContesta({
      botConfig, agentes: [], marcas: [marcaNativa],
      cuentas: [{ id: "c1", name: "WA Nativa", brandId: "m1" }], playbooks,
    });
    const f = r.cuentas[0];
    expect(f.estilo).toMatchObject({ valor: "EJECUTIVO_SOBRIO", origen: "marca" });
    expect(f.guion).toMatchObject({ valor: "pb-m", etiqueta: "Guion Nativa", origen: "marca" });
    expect(f.autonomia.origen).toBe("general");
    expect(f.contestaSolo).toBe(true);
  });

  it("marca sin estilo hereda el general; sin guion NO hereda el general", () => {
    const r = resolverQuienContesta({
      botConfig, agentes: [], marcas: [{ ...marcaNativa, tonePreset: null, playbookId: null }],
      cuentas: [{ id: "c1", name: "WA", brandId: "m1" }], playbooks,
    });
    expect(r.cuentas[0].estilo).toMatchObject({ valor: "PROFESIONAL_CALIDO", origen: "general" });
    expect(r.cuentas[0].guion.valor).toBeNull();
  });

  it("marca con el agente apagado: no contesta solo", () => {
    const r = resolverQuienContesta({
      botConfig, agentes: [], marcas: [{ ...marcaNativa, botEnabled: false }],
      cuentas: [{ id: "c1", name: "WA", brandId: "m1" }],
    });
    expect(r.cuentas[0].contestaSolo).toBe(false);
  });

  it("cuenta sin marca o con la predeterminada: general, aunque el botEnabled de la predeterminada sea false", () => {
    const r = resolverQuienContesta({
      botConfig, agentes: [], marcas: [marcaDefault],
      cuentas: [{ id: "c1", name: "A", brandId: null }, { id: "c2", name: "B", brandId: "m0" }], playbooks,
    });
    for (const f of r.cuentas) {
      expect(f.contestaSolo).toBe(true);
      expect(f.estilo.origen).toBe("general");
      expect(f.guion).toMatchObject({ valor: "pb-g", origen: "general" });
    }
    expect(r.cuentas[0].marca).toBe("Sin marca");
  });

  it("bot general apagado: las cuentas sin marca no contestan, las marcas encendidas sí", () => {
    const r = resolverQuienContesta({
      botConfig: { ...botConfig, botEnabled: false }, agentes: [], marcas: [marcaNativa],
      cuentas: [{ id: "c1", name: "A", brandId: null }, { id: "c2", name: "B", brandId: "m1" }],
    });
    expect(r.cuentas[0].contestaSolo).toBe(false);
    expect(r.cuentas[1].contestaSolo).toBe(true);
  });

  it("línea de asesor: nunca contesta el bot", () => {
    const r = resolverQuienContesta({
      botConfig, agentes: [], marcas: [], cuentas: [{ id: "c1", name: "Ana", brandId: null, scope: "ADVISOR" }],
    });
    expect(r.cuentas[0].contestaSolo).toBe(false);
    expect(r.cuentas[0].origen).toBe("Línea de asesor");
  });

  it("agentes activos: filas por tipo; el agente sin guion no hereda el general; ignora inactivos", () => {
    const r = resolverQuienContesta({
      botConfig,
      agentes: [
        { id: "a1", name: "Agente Brokers", contactTypes: ["BROKER"], tonePreset: "NEUTRO_DIRECTO", playbookId: "pb-a", isActive: true },
        { id: "a2", name: "Agente Clientes", contactTypes: ["CLIENTE_ACTUAL"], tonePreset: null, playbookId: null, isActive: true },
        { id: "a3", name: "Apagado", contactTypes: ["PROVEEDOR"], tonePreset: null, playbookId: null, isActive: false },
      ],
      marcas: [], cuentas: [{ id: "c1", name: "A", brandId: null }], playbooks,
    });
    expect(r.porTipo).toHaveLength(2);
    expect(r.porTipo[0].estilo).toMatchObject({ valor: "NEUTRO_DIRECTO", origen: "agente" });
    expect(r.porTipo[0].guion.etiqueta).toBe("Guion Brokers");
    expect(r.porTipo[1].estilo.origen).toBe("general");
    expect(r.porTipo[1].guion.valor).toBeNull();
    expect(r.cuentas[0].origen).toContain("tipo de contacto");
  });
});

describe("textoHereda", () => {
  it("estilo y guion", () => {
    expect(textoHereda("estilo", botConfig)).toBe("Hereda: Profesional-cálido (general)");
    expect(textoHereda("guion", botConfig, playbooks)).toBe("Hereda: General (general)");
    expect(textoHereda("guion", { ...botConfig, activePlaybookId: null })).toContain("sin guion");
  });
});

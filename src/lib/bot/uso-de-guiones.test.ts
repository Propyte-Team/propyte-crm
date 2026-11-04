import { describe, expect, it } from "vitest";
import { textoUsadoPor, usoDeGuiones } from "./uso-de-guiones";

const e = {
  botConfig: { activePlaybookId: "g1" },
  agentes: [
    { id: "a1", name: "Sage Brokers", contactTypes: [], tonePreset: null, playbookId: "g2", isActive: true },
    { id: "a2", name: "Otro", contactTypes: [], tonePreset: null, playbookId: "g1", isActive: false },
  ],
  marcas: [
    { id: "m1", name: "Nativa", isDefault: false, botEnabled: true, tonePreset: null, playbookId: "g1" },
    { id: "m2", name: "Sin cuentas", isDefault: false, botEnabled: true, tonePreset: null, playbookId: "g3" },
  ],
  cuentas: [
    { id: "c1", name: "WhatsApp Nativa", brandId: "m1" },
    { id: "c2", name: "IG Nativa", brandId: "m1" },
    { id: "c3", name: "Otra", brandId: null },
  ],
};

describe("usoDeGuiones", () => {
  it("junta bot general, marcas con sus cuentas y agentes", () => {
    const u = usoDeGuiones(e);
    expect(u.get("g1")).toEqual(["Bot general", "Marca Nativa (WhatsApp Nativa, IG Nativa)", "Agente Otro"]);
    expect(u.get("g2")).toEqual(["Agente Sage Brokers"]);
    expect(u.get("g3")).toEqual(["Marca Sin cuentas"]);
  });
  it("puede excluir al agente que se está editando", () => {
    expect(usoDeGuiones(e, "a2").get("g1")).toEqual(["Bot general", "Marca Nativa (WhatsApp Nativa, IG Nativa)"]);
  });
  it("texto: sin uso y con uso", () => {
    expect(textoUsadoPor(undefined)).toBe("sin uso");
    expect(textoUsadoPor(["Bot general", "Agente X"])).toBe("usado por: Bot general; Agente X");
  });
});

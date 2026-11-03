import { describe, it, expect } from "vitest";
import {
  estadoBot,
  etiquetaRespuesta,
  hrefConversacion,
  hrefWhatsApp,
  motivoLegible,
  origenLabel,
  respuestasLegibles,
  textoPuntaje,
  valorRespuesta,
} from "./presentacion";

describe("origen", () => {
  it("manual y chat con su canal", () => {
    expect(origenLabel({ source: "MANUAL" })).toBe("Manual");
    expect(origenLabel({ source: "CHAT", botCanal: "INSTAGRAM" })).toBe("Instagram");
    expect(origenLabel({ source: "CHAT", botCanal: "WHATSAPP" })).toBe("WhatsApp");
    expect(origenLabel({ source: "CHAT", botCanal: "MESSENGER" })).toBe("Messenger");
    expect(origenLabel({ source: "CHAT", botCanal: null })).toBe("Chat");
    expect(origenLabel({ source: "CONTACTO" })).toBe("Contactos");
  });
});

describe("columna Bot", () => {
  it("veredicto con puntaje y clase de color", () => {
    expect(estadoBot({ source: "CHAT", botResultado: "APTO", botPuntaje: 72 })).toEqual({
      tipo: "veredicto", veredicto: "APTO", label: "Apto", clase: "badge-success", puntaje: "72/100",
    });
    expect(estadoBot({ source: "CHAT", botResultado: "REVISAR", botPuntaje: null })).toMatchObject({ clase: "badge-warning", puntaje: null });
    expect(estadoBot({ source: "MANUAL", botResultado: "NO_APTO", botPuntaje: 10 })).toMatchObject({ label: "No apto", clase: "badge-neutral" });
  });
  it("chat sin evaluar → en guion; manual sin evaluar → nada", () => {
    expect(estadoBot({ source: "CHAT", botResultado: null })).toEqual({ tipo: "en_guion" });
    expect(estadoBot({ source: "MANUAL", botResultado: null })).toBeNull();
    expect(estadoBot({ source: "MANUAL", botResultado: "RARO" })).toBeNull();
  });
  it("textoPuntaje", () => {
    expect(textoPuntaje(72)).toBe("72/100");
    expect(textoPuntaje(undefined)).toBeNull();
  });
});

describe("motivo legible", () => {
  it("filtro, ambiguo y puntaje", () => {
    expect(motivoLegible("filtro:movilidad")).toBe("No pasó el filtro: Movilidad");
    expect(motivoLegible("ambiguo:colchon_meses")).toBe("Respuesta ambigua: Colchón económico");
    expect(motivoLegible("ambiguo:colchon_meses,movilidad")).toBe("Respuesta ambigua: Colchón económico, Movilidad");
    expect(motivoLegible("puntaje")).toBe("Por puntaje");
    expect(motivoLegible("filtro:mayor_edad")).toBe("No pasó el filtro: Mayor de edad");
  });
  it("vacío → null; desconocido se muestra tal cual", () => {
    expect(motivoLegible(null)).toBeNull();
    expect(motivoLegible("  ")).toBeNull();
    expect(motivoLegible("otra_cosa")).toBe("otra_cosa");
  });
});

describe("respuestas", () => {
  it("etiqueta sin el prefijo «Reclutamiento: », con o sin `reclutamiento_`", () => {
    expect(etiquetaRespuesta("acepta_comision")).toBe("Acepta 100 % comisión");
    expect(etiquetaRespuesta("reclutamiento_ingles")).toBe("Inglés");
  });
  it("valor del enum en palabras", () => {
    expect(valorRespuesta("movilidad", "SOLO_DISPOSICION")).toBe("solo disposición, sin vehículo");
    expect(valorRespuesta("reclutamiento_colchon_meses", "OTRO_INGRESO")).toBe("otro ingreso");
    expect(valorRespuesta("actitud_1", "Me gusta vender")).toBe("Me gusta vender");
  });
  it("lista en el orden del guion, sin vacíos; null/no-objeto → []", () => {
    const r = respuestasLegibles({ ingles: "BASICO", reclutamiento_mayor_edad: "SI", extra: "x", plaza: "", movilidad: "NO" });
    expect(r.map((x) => x.clave)).toEqual(["mayor_edad", "movilidad", "ingles", "extra"]);
    expect(r[0]).toEqual({ clave: "mayor_edad", etiqueta: "Mayor de edad", valor: "sí" });
    expect(respuestasLegibles(null)).toEqual([]);
    expect(respuestasLegibles(["a"])).toEqual([]);
  });
});

describe("enlaces", () => {
  it("WhatsApp solo con dígitos", () => {
    expect(hrefWhatsApp("+52 (984) 123-4567")).toBe("https://wa.me/529841234567");
    expect(hrefWhatsApp("")).toBeNull();
    expect(hrefWhatsApp(null)).toBeNull();
  });
  it("conversación en el inbox", () => {
    expect(hrefConversacion({ conversationId: "dbf17326" })).toBe("/inbox?c=dbf17326");
    expect(hrefConversacion({ conversationId: null })).toBeNull();
  });
});

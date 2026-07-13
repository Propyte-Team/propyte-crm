import { describe, it, expect } from "vitest";
import { formatForWhatsApp } from "./format";

describe("formatForWhatsApp — negritas markdown → formato WhatsApp", () => {
  it("convierte **negrita** a *negrita* (caso real de prod, 10-jul)", () => {
    expect(formatForWhatsApp("Agendo para **mañana a las 7 AM** — un asesor te contacta enseguida.")).toBe(
      "Agendo para *mañana a las 7 AM* — un asesor te contacta enseguida."
    );
  });

  it("convierte __negrita__ a *negrita*", () => {
    expect(formatForWhatsApp("Cita __confirmada__ para hoy")).toBe("Cita *confirmada* para hoy");
  });

  it("varios en una misma línea", () => {
    expect(formatForWhatsApp("**Zona:** Tulum y **presupuesto:** 3 MDP")).toBe(
      "*Zona:* Tulum y *presupuesto:* 3 MDP"
    );
  });

  it("** sin cierre NO se toca", () => {
    expect(formatForWhatsApp("Agendo **mañana sin cierre")).toBe("Agendo **mañana sin cierre");
    expect(formatForWhatsApp("a ** b")).toBe("a ** b");
  });

  it("un ** suelto no se come una negrita válida posterior en otra línea", () => {
    expect(formatForWhatsApp("**sin cierre\ny luego **real** al final")).toBe(
      "**sin cierre\ny luego *real* al final"
    );
  });

  it("negrita multilínea → negrita por línea (WhatsApp no formatea cruzando saltos)", () => {
    expect(formatForWhatsApp("**línea uno\nlínea dos**")).toBe("*línea uno*\n*línea dos*");
  });

  it("***negrita-itálica*** degrada a *negrita*", () => {
    expect(formatForWhatsApp("es ***urgente*** verlo")).toBe("es *urgente* verlo");
  });

  it("recorta espacios pegados a los delimitadores (WhatsApp no renderea '* x *')", () => {
    expect(formatForWhatsApp("hola ** negrita ** mundo")).toBe("hola *negrita* mundo");
  });
});

describe("formatForWhatsApp — encabezados #", () => {
  it("# encabezado al inicio de línea → *negrita*", () => {
    expect(formatForWhatsApp("# Resumen\ntexto normal")).toBe("*Resumen*\ntexto normal");
    expect(formatForWhatsApp("## Opciones en Tulum")).toBe("*Opciones en Tulum*");
  });

  it("#hashtag (sin espacio) NO se toca", () => {
    expect(formatForWhatsApp("checa #TulumRealEstate")).toBe("checa #TulumRealEstate");
  });

  it("# en medio de la línea NO se toca", () => {
    expect(formatForWhatsApp("depto # 4 disponible")).toBe("depto # 4 disponible");
  });

  it("encabezado que ya trae negrita: solo quita los # (no anida asteriscos)", () => {
    expect(formatForWhatsApp("# Hola **Ana**")).toBe("Hola *Ana*");
  });
});

describe("formatForWhatsApp — deja intacto lo demás", () => {
  it("*negrita WhatsApp*, _itálica_ y ~tachado~ quedan igual", () => {
    const s = "ya *confirmado*, _mañana_ y ~cancelado~";
    expect(formatForWhatsApp(s)).toBe(s);
  });

  it("URLs, snake_case, emojis y saltos de línea quedan igual", () => {
    const s = "Mira https://propyte.com/desarrollos?zona=tulum_centro 🙂\n¿Te late?";
    expect(formatForWhatsApp(s)).toBe(s);
  });

  it("string vacío y texto sin markdown", () => {
    expect(formatForWhatsApp("")).toBe("");
    expect(formatForWhatsApp("hola, ¿cómo vas?")).toBe("hola, ¿cómo vas?");
  });
});

describe("formatForWhatsApp — idempotencia (se aplica en transport y en el servicio)", () => {
  it("aplicarla dos veces = aplicarla una vez", () => {
    const samples = [
      "Agendo para **mañana a las 7 AM** — listo.",
      "# Resumen\n**a** y __b__ y ***c***",
      "**multi\nlínea** y *ya ok*",
      "**sin cierre y _italica_",
    ];
    for (const s of samples) {
      const once = formatForWhatsApp(s);
      expect(formatForWhatsApp(once)).toBe(once);
    }
  });
});

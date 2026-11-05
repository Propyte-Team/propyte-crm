import { describe, it, expect } from "vitest";
import {
  claveDeZona,
  elegirPlantilla,
  enlaceCorreo,
  enlaceWhatsApp,
  llenarVariables,
  rolDelAsesor,
  textoListo,
  varianteCifra,
  varianteInicial,
  varianteLineaValor,
  zonaDelContacto,
  type Plantilla,
  type VariablesPlantilla,
} from "./plantillas";

const vars = (v: Partial<VariablesPlantilla> = {}): VariablesPlantilla => ({
  nombre: "Ana",
  asesor: "Conrad Alvarado",
  rol: "Gerente comercial",
  proyecto: null,
  zona: "Playa del Carmen",
  waAsesor: "https://wa.me/529841234567",
  lineaValor: null,
  cifra: "+13.5%",
  ...v,
});

const p = (x: Partial<Plantilla>): Plantilla => ({
  id: "x",
  codigo: "WA1",
  idioma: "ES",
  variante: "",
  canal: "WHATSAPP",
  nombre: "WA1",
  asunto: null,
  cuerpo: "",
  ...x,
});

describe("variables", () => {
  it("llena las que sabe el CRM y deja las que no, para que las llene el asesor", () => {
    const t = textoListo(
      p({ cuerpo: "Hola [NOMBRE], soy [ASESOR], de Propyte. Vi que pediste info de [PROYECTO]. [ZONA] va en [N] de [M]." }),
      vars(),
      "ES",
    )!;
    expect(t.texto).toBe("Hola Ana, soy Conrad Alvarado, de Propyte. Vi que pediste info de [PROYECTO]. Playa del Carmen va en [N] de [M].");
    expect(t.faltan).toEqual(["[PROYECTO]", "[N]", "[M]"]);
    expect(t.otroIdioma).toBe(false);
  });

  it("la línea de valor y la firma traen variables adentro y también se llenan", () => {
    const texto = llenarVariables(
      "[LÍNEA DE VALOR]\n\n[firma]",
      vars({ zona: "Tulum", lineaValor: "Te soy directo: no todo lo que se vende en [ZONA] tiene sentido." }),
    );
    expect(texto).toBe("Te soy directo: no todo lo que se vende en Tulum tiene sentido.\n\nConrad Alvarado · Gerente comercial · Propyte · https://wa.me/529841234567");
  });

  it("acepta la marca larga del PDF para la línea de valor, en los dos idiomas", () => {
    expect(llenarVariables("[LÍNEA DE VALOR — elige del menú abajo]", vars({ lineaValor: "X" }))).toBe("X");
    expect(llenarVariables("[VALUE LINE — pick one from the menu below]", vars({ lineaValor: "Y" }))).toBe("Y");
  });

  it("sin teléfono del asesor, [wa.me/NÚMERO] se queda para llenarlo", () => {
    const t = textoListo(p({ cuerpo: "Por WhatsApp: [wa.me/NÚMERO]" }), vars({ waAsesor: null }), "ES")!;
    expect(t.faltan).toEqual(["[wa.me/NÚMERO]"]);
  });

  it("el asunto también se llena", () => {
    const t = textoListo(p({ canal: "CORREO", asunto: "[NOMBRE], sobre [ZONA]", cuerpo: "Hola" }), vars(), "ES")!;
    expect(t.asunto).toBe("Ana, sobre Playa del Carmen");
  });
});

describe("zona, línea de valor y cifra (regla zona–cifra del PDF)", () => {
  it("la zona es la preferida; si no hay, la de la plaza", () => {
    expect(zonaDelContacto(" Cancún ", "PDC")).toBe("Cancún");
    expect(zonaDelContacto(null, "PDC")).toBe("Playa del Carmen");
    expect(zonaDelContacto(null, "MERIDA")).toBe("Mérida");
    expect(zonaDelContacto("", null)).toBeNull();
  });
  it("Playa → A y +13.5 · Cancún → B y +13.3 · Q. Roo → C y +13.4 · Tulum y el resto → D sin cifra", () => {
    expect([claveDeZona("Playa del carmen"), varianteLineaValor("PDC"), varianteCifra("PDC")]).toEqual(["PDC", "A", "PDC"]);
    expect([claveDeZona("Cancun"), varianteLineaValor("CANCUN")]).toEqual(["CANCUN", "B"]);
    expect([claveDeZona("Puerto Morelos"), varianteLineaValor("QROO")]).toEqual(["QROO", "C"]);
    expect([claveDeZona("Tulum"), varianteLineaValor("TULUM"), varianteCifra("TULUM")]).toEqual(["TULUM", "D", null]);
    expect([claveDeZona("Mérida"), varianteLineaValor(null), varianteCifra(null)]).toEqual([null, "D", null]);
    expect(claveDeZona("Coco Beach")).toBe("PDC");
  });
});

describe("variantes y plantillas", () => {
  it("Credibilidad arranca en Método; Objeción en Fideicomiso para extranjeros y Seguridad jurídica para México", () => {
    expect(varianteInicial("WA3", { pais: "MX", idioma: "ES" })).toBe("METODO");
    expect(varianteInicial("CORREO4", { pais: "US", idioma: "EN" })).toBe("FIDEICOMISO");
    expect(varianteInicial("WA4", { pais: "MX", idioma: "EN" })).toBe("FIDEICOMISO");
    expect(varianteInicial("WA4", { pais: "MX", idioma: "ES" })).toBe("SEGURIDAD");
    expect(varianteInicial("WA1", { pais: "MX", idioma: "ES" })).toBe("");
  });
  it("si no hay en el idioma del lead, sale la del otro idioma", () => {
    const lista = [p({ codigo: "SMS_C2", idioma: "EN", cuerpo: "en" }), p({ codigo: "WA1", idioma: "ES", cuerpo: "es" }), p({ codigo: "WA1", idioma: "EN", cuerpo: "en1" })];
    expect(elegirPlantilla(lista, "SMS_C2", "ES")?.cuerpo).toBe("en");
    expect(elegirPlantilla(lista, "WA1", "EN")?.cuerpo).toBe("en1");
    expect(elegirPlantilla(lista, "WA9", "ES")).toBeNull();
    expect(textoListo(elegirPlantilla(lista, "SMS_C2", "ES"), vars(), "ES")?.otroIdioma).toBe(true);
  });
});

describe("asesor y enlaces", () => {
  it("[ROL] sale del rol del usuario", () => {
    expect(rolDelAsesor("ASESOR", "ES")).toBe("Asesor comercial");
    expect(rolDelAsesor("GERENTE", "EN")).toBe("Sales Manager");
  });
  it("wa.me y mailto con el texto ya escrito", () => {
    expect(enlaceWhatsApp("+52 984 123 4567", "Hola Ana")).toBe("https://wa.me/529841234567?text=Hola%20Ana");
    expect(enlaceWhatsApp(null)).toBeNull();
    expect(enlaceCorreo("a@b.mx", "Hola", "Texto")).toBe("mailto:a@b.mx?subject=Hola&body=Texto");
    expect(enlaceCorreo(null, null, "x")).toBeNull();
  });
});

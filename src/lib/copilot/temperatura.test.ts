import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GRUPO_POR_FUENTE,
  ORDEN,
  SENAL_DE_COMPRA,
  calcularTemperatura,
  esSenalDeCompra,
  etiquetaTemperatura,
  type EntradaTemperatura,
} from "./temperatura";
import { patronSenalPostgres } from "./temperatura-recalcular";

// #973 — reglas de Luis (3.ª y 4.ª ronda) y decisiones de sistemas@ (04-nov).
const AHORA = new Date("2026-11-04T18:00:00Z");
const hace = (dias: number, horas = 0) => new Date(AHORA.getTime() - dias * 86_400_000 - horas * 3_600_000);
const base = (e: Partial<EntradaTemperatura> = {}): EntradaTemperatura => ({
  fuente: "META_ADS",
  estado: "NUEVO",
  razonSalida: null,
  doNotContact: false,
  entradaAt: hace(1),
  ultimaRespuestaAt: null,
  senalCompraAt: null,
  ...e,
});
const t = (e: Partial<EntradaTemperatura>) => calcularTemperatura(base(e), AHORA);

describe("temperatura inicial por fuente (#973)", () => {
  it("cubre todas las fuentes del CRM", () => {
    const schema = readFileSync(join(__dirname, "..", "..", "..", "prisma", "schema.prisma"), "utf8");
    const m = schema.match(/enum LeadSource \{([\s\S]*?)\}/)!;
    const fuentes = m[1].split("\n").map((l) => l.replace(/\/\/.*$/, "").trim()).filter((l) => l && !l.startsWith("@@"));
    expect(fuentes.filter((f) => !(f in GRUPO_POR_FUENTE))).toEqual([]);
  });

  it("Caliente, Tibio A, Tibio B y Frío según Luis", () => {
    expect(t({ fuente: "LLAMADA_ENTRANTE" })).toMatchObject({ temperatura: "HOT" });
    expect(t({ fuente: "WALK_IN" })).toMatchObject({ temperatura: "HOT" });
    for (const f of ["WEBSITE", "WHATSAPP", "GOOGLE_ADS", "PORTAL_INMOBILIARIO", "EVENTO", "REFERIDO_BROKER", "REGISTRO_BROKER"]) {
      expect(t({ fuente: f })).toMatchObject({ temperatura: "WARM", grupo: "A", orden: ORDEN.TIBIO_A });
    }
    expect(t({ fuente: "REFERIDO_CLIENTE" })).toMatchObject({ temperatura: "WARM", grupo: "A", orden: ORDEN.TIBIO_A_REFERIDO });
    for (const f of ["META_ADS", "FACEBOOK_ADS", "INSTAGRAM", "MESSENGER", "TIKTOK_ADS"]) {
      expect(t({ fuente: f })).toMatchObject({ temperatura: "WARM", grupo: "B", orden: ORDEN.TIBIO_B });
    }
    for (const f of ["BASE_DE_DATOS", "SELF_GEN", "LLAMADA_FRIA"]) expect(t({ fuente: f })).toMatchObject({ temperatura: "COLD", grupo: null });
  });

  it("Otro, Webinar y LinkedIn arrancan en Tibio B (sistemas@ 04-nov); sin fuente también", () => {
    for (const f of ["OTRO", "WEBINAR", "LINKEDIN", null]) expect(t({ fuente: f })).toMatchObject({ temperatura: "WARM", grupo: "B" });
  });

  it("el motivo dice la fuente", () => {
    expect(t({ fuente: "META_ADS" }).motivo).toBe("Tibio: Meta Ads");
    expect(t({ fuente: "SELF_GEN" }).motivo).toBe("Frío: prospección propia");
  });
});

describe("no aplica y muerto (#973)", () => {
  it("Registrado por broker y Derivado a RH no llevan temperatura", () => {
    expect(t({ estado: "REGISTRADO_POR_BROKER", fuente: "REGISTRO_BROKER" })).toMatchObject({ temperatura: null, orden: ORDEN.NO_APLICA });
    expect(t({ estado: "DERIVADO_A_RH" })).toMatchObject({ temperatura: null });
  });

  it("Muerto: No contactar, Perdido · Datos incorrectos o Spam, Contactado perdido · No califica", () => {
    expect(t({ doNotContact: true })).toMatchObject({ temperatura: "DEAD", orden: ORDEN.MUERTO });
    expect(t({ estado: "NEGOCIO_PERDIDO", razonSalida: "NO_CONTACTAR" })).toMatchObject({ temperatura: "DEAD" });
    expect(t({ estado: "PERDIDO", razonSalida: "SPAM" })).toMatchObject({ temperatura: "DEAD", motivo: "Muerto: spam" });
    expect(t({ estado: "PERDIDO", razonSalida: "DATOS_INCORRECTOS" })).toMatchObject({ temperatura: "DEAD" });
    expect(t({ estado: "CONTACTADO_PERDIDO", razonSalida: "NO_CALIFICA" })).toMatchObject({ temperatura: "DEAD" });
    // Otras salidas no están muertas.
    expect(t({ estado: "PERDIDO", razonSalida: "SIN_RESPUESTA_TRAS_CADENCIA" }).temperatura).not.toBe("DEAD");
  });

  it("No contactar gana aunque haya una señal de compra", () => {
    expect(t({ doNotContact: true, senalCompraAt: hace(0, 1) })).toMatchObject({ temperatura: "DEAD" });
  });
});

describe("caliente (#973)", () => {
  it("señal de compra en las últimas 72 h, con qué fue y cuándo", () => {
    const r = t({ fuente: "BASE_DE_DATOS", senalCompraAt: hace(0, 3), senalCompra: "preguntó por precio, disponibilidad o pagos" });
    expect(r).toMatchObject({ temperatura: "HOT", orden: ORDEN.CALIENTE });
    expect(r.motivo).toBe("Caliente: preguntó por precio, disponibilidad o pagos hace 3 h");
    expect(t({ senalCompraAt: hace(3) }).temperatura).toBe("HOT"); // justo 72 h
    expect(t({ senalCompraAt: hace(3, 1) }).temperatura).toBe("WARM"); // ya pasó
  });

  it("Propuesta en adelante y respondió en 7 días", () => {
    for (const estado of ["PROPUESTA", "APARTADO", "FIRMA", "ESCRITURA", "POSTVENTA"]) {
      expect(t({ estado, ultimaRespuestaAt: hace(6) }).temperatura).toBe("HOT");
    }
    expect(t({ estado: "PROPUESTA", ultimaRespuestaAt: hace(8) }).temperatura).toBe("WARM");
    expect(t({ estado: "DEMO", ultimaRespuestaAt: hace(1) }).temperatura).toBe("WARM"); // antes de Propuesta, no
  });

  it("una fuente caliente baja a Tibio A tras 7 días sin respuesta", () => {
    expect(t({ fuente: "WALK_IN", entradaAt: hace(8) })).toMatchObject({ temperatura: "WARM", grupo: "A" });
    expect(t({ fuente: "WALK_IN", entradaAt: hace(20), ultimaRespuestaAt: hace(2) }).temperatura).toBe("HOT");
    expect(t({ fuente: "WALK_IN", entradaAt: hace(8) }).motivo).toBe("Tibio: walk-in (pasaron 7 días sin respuesta)");
  });
});

describe("enfriamiento (#973)", () => {
  it("solo en nutrición (salidas) o Base de datos: Tibio B a 30 días, Tibio A a 60, desde la última respuesta", () => {
    expect(t({ estado: "CONTACTADO_PERDIDO", razonSalida: "DEJO_DE_RESPONDER", fuente: "META_ADS", ultimaRespuestaAt: hace(31) })).toMatchObject({ temperatura: "COLD" });
    expect(t({ estado: "CONTACTADO_PERDIDO", fuente: "META_ADS", ultimaRespuestaAt: hace(29) })).toMatchObject({ temperatura: "WARM", grupo: "B" });
    expect(t({ estado: "NEGOCIO_PERDIDO", fuente: "WEBSITE", ultimaRespuestaAt: hace(59) })).toMatchObject({ temperatura: "WARM", grupo: "A" });
    expect(t({ estado: "NEGOCIO_PERDIDO", fuente: "WEBSITE", ultimaRespuestaAt: hace(61) })).toMatchObject({ temperatura: "COLD" });
    // Sin respuesta nunca: cuenta desde que entró.
    expect(t({ estado: "PERDIDO", fuente: "META_ADS", entradaAt: hace(40) }).temperatura).toBe("COLD");
  });

  it("en un estado activo no se enfría aunque sea viejo", () => {
    expect(t({ estado: "CONTACTADO", fuente: "META_ADS", entradaAt: hace(400) })).toMatchObject({ temperatura: "WARM", grupo: "B" });
  });

  it("el motivo dice desde cuándo no responde", () => {
    expect(t({ estado: "NEGOCIO_PERDIDO", fuente: "META_ADS", ultimaRespuestaAt: hace(45) }).motivo).toBe("Frío: sin responder desde hace 45 días (Meta Ads)");
  });
});

describe("señal de compra en el texto (#973)", () => {
  it("encuentra precio, disponibilidad, pagos, apartado… en español e inglés", () => {
    for (const s of [
      "¿Cuál es el precio del depa de 2 recámaras?",
      "cuanto cuesta?",
      "¿Siguen disponibles?",
      "me mandas el plan de pagos",
      "Quiero ver la corrida financiera",
      "¿de cuánto es el enganche?",
      "Quiero apartar",
      "¿Aceptan crédito?",
      "What's the price?",
      "Is it still available?",
      "Do you have a payment plan?",
      "how much is the down payment",
    ]) expect(esSenalDeCompra(s)).toBe(true);
  });

  it("no se calienta con un saludo ni con palabras parecidas", () => {
    for (const s of ["Hola, buenas tardes", "gracias", "Vivo en un apartamento", "Costa Rica", "ok", null, ""]) {
      expect(esSenalDeCompra(s)).toBe(false);
    }
  });

  it("el patrón de Postgres es el mismo con \\y en lugar de \\b", () => {
    const pg = patronSenalPostgres();
    expect(pg).not.toContain("\\b");
    expect(pg).toContain("\\y");
    expect(pg.replace(/\\y/g, "\\b")).toBe(SENAL_DE_COMPRA.source);
  });
});

describe("etiquetas (#973)", () => {
  it("lo que ve el asesor", () => {
    expect(["HOT", "WARM", "COLD", "DEAD", null].map(etiquetaTemperatura)).toEqual(["Caliente", "Tibio", "Frío", "Muerto", "Sin temperatura"]);
  });
});

import { describe, expect, it } from "vitest";
import { calcularScore, umbralesCruzados, type SenalesScore } from "./calcular";
import { MODELO_DEFAULT, modeloSchema, resolverModelo, ventanaMaxDias } from "./modelo";

const AHORA = new Date("2026-10-26T12:00:00Z");
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000);
const sinSenales: SenalesScore = { actividades: [], entrantes: [], playbookCompletado: false, web: null };

describe("MODELO_DEFAULT", () => {
  it("pasa su propia validación", () => {
    expect(modeloSchema.safeParse(MODELO_DEFAULT).success).toBe(true);
  });

  it("la ventana máxima cubre la regla más larga", () => {
    expect(ventanaMaxDias(MODELO_DEFAULT)).toBe(60);
  });
});

describe("resolverModelo", () => {
  it("sin valor guardado usa el default", () => {
    expect(resolverModelo(undefined)).toEqual({ modelo: MODELO_DEFAULT });
  });

  it("un modelo inválido NO rompe: cae al default y explica por qué", () => {
    const r = resolverModelo({ version: 2, reglas: "no-es-lista" });
    expect(r.modelo).toBe(MODELO_DEFAULT);
    expect(r.error).toMatch(/reglas/);
  });

  it("acepta un modelo editado a mano", () => {
    const editado = { ...MODELO_DEFAULT, version: 2, topesPorFamilia: { ...MODELO_DEFAULT.topesPorFamilia, fuente: 20 } };
    const r = resolverModelo(JSON.parse(JSON.stringify(editado)));
    expect(r.error).toBeUndefined();
    expect(r.modelo.version).toBe(2);
    expect(r.modelo.topesPorFamilia.fuente).toBe(20);
  });

  it("rechaza ids de regla repetidos", () => {
    const r = resolverModelo({ ...MODELO_DEFAULT, reglas: [...MODELO_DEFAULT.reglas, MODELO_DEFAULT.reglas[0]] });
    expect(r.error).toMatch(/repetida/);
  });
});

describe("calcularScore", () => {
  it("un lead de anuncio sin nada más vale solo su fuente", () => {
    const r = calcularScore({ leadSource: "FACEBOOK_ADS", phone: "+5219980000000" }, sinSenales, MODELO_DEFAULT, AHORA);
    expect(r.score).toBe(5);
    expect(r.desglose.map((d) => d.regla)).toEqual(["fuente"]);
  });

  it("excluye brokers y candidatos: score null, no 0", () => {
    const r = calcularScore({ contactType: "BROKER_EXTERNO", leadSource: "REFERIDO_BROKER" }, sinSenales, MODELO_DEFAULT, AHORA);
    expect(r.score).toBeNull();
    expect(r.motivo).toMatch(/BROKER_EXTERNO/);
  });

  it("descartado o no-contactar queda en 0", () => {
    expect(calcularScore({ contactStatus: "DESCARTADO", leadSource: "WALK_IN" }, sinSenales, MODELO_DEFAULT, AHORA).score).toBe(0);
    expect(calcularScore({ doNotContact: true, leadSource: "WALK_IN" }, sinSenales, MODELO_DEFAULT, AHORA).score).toBe(0);
  });

  it("un comprador caliente llega a SQL y respeta los topes por familia", () => {
    const r = calcularScore(
      {
        leadSource: "REFERIDO_CLIENTE",
        purchaseTimeline: "IMMEDIATE",
        urgency: "ALTA",
        paymentMethod: "CONTADO",
        budgetMax: 400_000,
        budgetCurrency: "USD",
        investmentProfile: "END_USER",
        phone: "+5219980000000",
        email: "a@b.com",
      },
      {
        actividades: [{ tipo: "MEETING_SHOWROOM", fecha: hace(2) }],
        entrantes: [hace(3), hace(2), hace(1)],
        playbookCompletado: true,
        web: { daysVisited: 3, chatCount: 1 },
      },
      MODELO_DEFAULT,
      AHORA
    );
    // perfil 14+6+8+10+2+2 = 42 → tope 40 · fuente 12 · conversación 14+8 = 22 · web/citas 15+3+2 = 20
    expect(r.score).toBe(94);
    expect(r.desglose.find((d) => d.regla === "presupuesto")?.puntos).toBe(10); // 400k USD × 18 = 7.2 M MXN
    expect(r.desglose.find((d) => d.regla === "entrantes")).toMatchObject({ puntos: 14, veces: 3 });
  });

  it("los entrantes cuentan mensajes y actividades *_IN, con tope", () => {
    const r = calcularScore(
      { leadSource: "OTRO" },
      { ...sinSenales, entrantes: Array.from({ length: 10 }, (_, i) => hace(i)), actividades: [{ tipo: "WHATSAPP_IN", fecha: hace(1) }] },
      MODELO_DEFAULT,
      AHORA
    );
    expect(r.desglose.find((d) => d.regla === "entrantes")).toMatchObject({ puntos: 16, veces: 11 });
  });

  it("lo que cae fuera de la ventana no suma", () => {
    const r = calcularScore({ leadSource: "OTRO" }, { ...sinSenales, entrantes: [hace(45)] }, MODELO_DEFAULT, AHORA);
    expect(r.desglose.find((d) => d.regla === "entrantes")).toBeUndefined();
  });

  it("decae la conversación y las citas, no el perfil", () => {
    const contacto = { leadSource: "WEBSITE", paymentMethod: "CONTADO" };
    const fresco = calcularScore(contacto, { ...sinSenales, actividades: [{ tipo: "MEETING_VIRTUAL", fecha: hace(5) }] }, MODELO_DEFAULT, AHORA);
    const viejo = calcularScore(contacto, { ...sinSenales, actividades: [{ tipo: "MEETING_VIRTUAL", fecha: hace(5) }] }, MODELO_DEFAULT, new Date(AHORA.getTime() + 50 * 86_400_000));
    expect(fresco.desglose.find((d) => d.regla === "cita")?.puntos).toBe(15);
    // 55 días después la cita ya salió... de no ser por la ventana de 60 días; decae un periodo (25 %).
    expect(viejo.decaimiento).toBe(0.75);
    expect(viejo.desglose.find((d) => d.regla === "cita")?.puntos).toBe(11);
    expect(viejo.desglose.find((d) => d.regla === "pago")?.puntos).toBe(8);
  });

  it("presupuesto sin moneda se toma como MXN", () => {
    const r = calcularScore({ leadSource: "OTRO", budgetMin: "3500000" }, sinSenales, MODELO_DEFAULT, AHORA);
    expect(r.desglose.find((d) => d.regla === "presupuesto")?.puntos).toBe(7);
  });

  it("un valor que el modelo no conoce no suma ni truena", () => {
    const r = calcularScore({ leadSource: "VALOR_NUEVO" }, sinSenales, MODELO_DEFAULT, AHORA);
    expect(r.score).toBe(0);
  });
});

describe("umbralesCruzados", () => {
  const u = MODELO_DEFAULT.umbrales;
  it("detecta cruces en ambas direcciones", () => {
    expect(umbralesCruzados(30, 72, u)).toEqual([35, 50, 70]);
    expect(umbralesCruzados(85, 60, u)).toEqual([70, 80]);
  });
  it("un cambio dentro del mismo tramo no cruza nada", () => {
    expect(umbralesCruzados(40, 45, u)).toEqual([]);
  });
});

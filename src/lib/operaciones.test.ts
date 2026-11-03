import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TIPO_OPERACION_ORDER,
  TIPO_OPERACION_LABELS,
  ETAPA_OPERACION_ORDER,
  ETAPA_OPERACION_LABELS,
  ETAPA_OPERACION_COLORS,
  FORMA_PAGO_ORDER,
  FORMA_PAGO_LABELS,
  NIVEL_MB_ORDER,
  ESTADOS_DE_OPERACION,
  ETAPAS_ACTIVAS,
  tipoPorFlujo,
  siguientesEtapas,
  subestadosDeEtapa,
  subestadoInicial,
  etapaALegacy,
  validarCambioDeOperacion,
  separarOperaciones,
  muestraCasillas,
  etiquetaEtapa,
  type OperacionActual,
} from "./operaciones";
import { ESTADO_ORDER, ESTADOS_POR_OPERACION, SUBESTADOS, type Estado } from "./estados";

// #957. Los enums viven en operaciones.ts y tienen que decir lo mismo que schema.prisma y que la
// migración; la etapa vieja que sale de etapaALegacy tiene que existir en DealStage.
const raiz = join(__dirname, "..", "..");
const schema = readFileSync(join(raiz, "prisma", "schema.prisma"), "utf8");
const migracion = readFileSync(join(raiz, "prisma", "migrations-manual", "2026-11-03-operaciones.sql"), "utf8");

function valoresDelEnumPrisma(nombre: string): string[] {
  const m = schema.match(new RegExp(`enum ${nombre} \\{([\\s\\S]*?)\\}`));
  if (!m) throw new Error(`enum ${nombre} no está en schema.prisma`);
  return m[1]
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => l && !l.startsWith("@@"));
}
function valoresDelTipo(nombre: string): string[] {
  const m = migracion.match(new RegExp(`CREATE TYPE propyte_crm\\."${nombre}" AS ENUM \\(([\\s\\S]*?)\\);`));
  if (!m) throw new Error(`la migración no crea ${nombre}`);
  return [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
}

const venta = (etapa: string | null, extra: Partial<OperacionActual> = {}): OperacionActual => ({
  tipoOperacion: "VENTA",
  etapa,
  subestado: null,
  contratoFirmado: false,
  enganchePagado: false,
  flujo: "F5_NATIVA",
  ...extra,
});

describe("Lista única de operaciones (#957)", () => {
  it("tipos, etapas y formas de pago coinciden con Prisma y con la migración", () => {
    expect(valoresDelEnumPrisma("TipoOperacion")).toEqual([...TIPO_OPERACION_ORDER]);
    expect(valoresDelTipo("TipoOperacion")).toEqual([...TIPO_OPERACION_ORDER]);
    expect(valoresDelEnumPrisma("EtapaOperacion")).toEqual([...ETAPA_OPERACION_ORDER]);
    expect(valoresDelTipo("EtapaOperacion")).toEqual([...ETAPA_OPERACION_ORDER]);
    expect(valoresDelEnumPrisma("FormaPago")).toEqual([...FORMA_PAGO_ORDER]);
    expect(valoresDelTipo("FormaPago")).toEqual([...FORMA_PAGO_ORDER]);
    expect(Object.keys(TIPO_OPERACION_LABELS)).toEqual([...TIPO_OPERACION_ORDER]);
    expect(Object.keys(ETAPA_OPERACION_LABELS)).toEqual([...ETAPA_OPERACION_ORDER]);
    expect(Object.keys(ETAPA_OPERACION_COLORS)).toEqual([...ETAPA_OPERACION_ORDER]);
    expect(Object.keys(FORMA_PAGO_LABELS)).toEqual([...FORMA_PAGO_ORDER]);
  });

  it("el CHECK de nivelMb de la migración dice los mismos niveles", () => {
    const m = migracion.match(/"nivelMb" IN \(([^)]*)\)/);
    expect([...(m?.[1] ?? "").matchAll(/'([A-Z0-9]+)'/g)].map((x) => x[1])).toEqual([...NIVEL_MB_ORDER]);
  });

  it("las etapas activas son estados del contacto, con los mismos subestados, y son los que pone el disparador", () => {
    expect([...ESTADOS_DE_OPERACION]).toEqual([...ESTADOS_POR_OPERACION]);
    expect([...ETAPAS_ACTIVAS]).toEqual([...ESTADOS_DE_OPERACION]);
    for (const e of ETAPAS_ACTIVAS) {
      expect(ESTADO_ORDER).toContain(e);
      expect(subestadosDeEtapa(e).map((o) => o.valor)).toEqual((SUBESTADOS[e as Estado] ?? []).map((o) => o.valor));
    }
    // El disparador elige entre las mismas cuatro.
    const disparador = migracion.split("FUNCTION propyte_crm.estado_desde_operaciones()")[1];
    expect(disparador).toMatch(/d\.etapa IN \('APARTADO', 'FIRMA', 'ESCRITURA', 'POSTVENTA'\)/);
    expect(subestadosDeEtapa("EN_PREPARACION")).toEqual([]);
    expect(subestadosDeEtapa("CANCELADA")).toEqual([]);
  });

  it("la etapa vieja que sale de cada etapa existe en DealStage", () => {
    const stages = valoresDelEnumPrisma("DealStage");
    for (const e of ETAPA_OPERACION_ORDER) {
      for (const s of [null, ...subestadosDeEtapa(e).map((o) => o.valor)]) {
        expect(stages).toContain(etapaALegacy(e, s));
      }
    }
  });
});

describe("Tipo y etapas (#957, Luis 02-nov)", () => {
  it("el tipo sale del flujo", () => {
    expect(tipoPorFlujo("F1_CORRETAJE_VENDEDOR")).toBe("CONTRATO_INTERMEDIACION");
    expect(tipoPorFlujo("F3_CAPTACION_MB")).toBe("CONTRATO_MB");
    expect(tipoPorFlujo("F6_BROKER")).toBe("CONVENIO_ALIADO");
    expect(tipoPorFlujo("F7_INMOBILIARIA")).toBe("CONVENIO_ALIADO");
    for (const f of ["F2_CORRETAJE_COMPRADOR", "F4_MB", "F5_NATIVA", null, undefined]) expect(tipoPorFlujo(f)).toBe("VENTA");
  });

  it("la venta se aparta, firma, escritura y entra a postventa; el contrato y el convenio nacen al firmarse", () => {
    expect(siguientesEtapas("VENTA", "EN_PREPARACION")).toEqual(["APARTADO", "CANCELADA"]);
    expect(siguientesEtapas("VENTA", null)).toEqual(["APARTADO", "CANCELADA"]); // negocio de antes
    expect(siguientesEtapas("VENTA", "APARTADO")).toEqual(["FIRMA", "CANCELADA"]);
    expect(siguientesEtapas("VENTA", "ESCRITURA")).toEqual(["POSTVENTA"]);
    expect(siguientesEtapas("VENTA", "POSTVENTA")).toEqual([]);
    expect(siguientesEtapas("VENTA", "CANCELADA")).toEqual([]);
    expect(siguientesEtapas("CONTRATO_INTERMEDIACION", "EN_PREPARACION")).toEqual(["FIRMA", "CANCELADA"]);
    expect(siguientesEtapas("CONTRATO_INTERMEDIACION", "FIRMA")).toEqual(["ESCRITURA", "CANCELADA"]);
    expect(siguientesEtapas("CONTRATO_MB", "FIRMA")).toEqual(["CANCELADA"]);
    expect(siguientesEtapas("CONVENIO_ALIADO", "EN_PREPARACION")).toEqual(["FIRMA", "CANCELADA"]);
  });

  it("Devengo activo solo en venta e intermediación; Nativa ve los subestados de financiamiento", () => {
    expect(subestadosDeEtapa("FIRMA", { tipo: "VENTA" }).map((o) => o.valor)).toContain("DEVENGO_ACTIVO");
    expect(subestadosDeEtapa("FIRMA", { tipo: "CONTRATO_MB" }).map((o) => o.valor)).not.toContain("DEVENGO_ACTIVO");
    expect(subestadosDeEtapa("FIRMA", { tipo: "CONVENIO_ALIADO" }).map((o) => o.valor)).not.toContain("DEVENGO_ACTIVO");
    expect(subestadosDeEtapa("APARTADO", { flujo: "F5_NATIVA" }).map((o) => o.valor)).toContain("FINANCIAMIENTO_EN_TRAMITE");
    expect(subestadosDeEtapa("APARTADO", { flujo: "F2_CORRETAJE_COMPRADOR" }).map((o) => o.valor)).not.toContain("FINANCIAMIENTO_EN_TRAMITE");
    expect(subestadoInicial("APARTADO")).toBe("PENDIENTE_DE_PAGO");
    expect(subestadoInicial("FIRMA")).toBe("AGENDADA");
  });

  it("etapa vieja: Firma es Contrato firmado hasta el devengo; Escritura y Postventa son Ganado", () => {
    expect(etapaALegacy("EN_PREPARACION", null)).toBe("PROPOSAL_SENT");
    expect(etapaALegacy("APARTADO", "PAGADO")).toBe("RESERVED");
    expect(etapaALegacy("FIRMA", "FIRMADO")).toBe("CONTRACT_SIGNED");
    expect(etapaALegacy("FIRMA", "DEVENGO_ACTIVO")).toBe("WON");
    expect(etapaALegacy("ESCRITURA", null)).toBe("WON");
    expect(etapaALegacy("POSTVENTA", "ENTREGADA")).toBe("WON");
    expect(etapaALegacy("CANCELADA", null)).toBe("LOST");
  });
});

describe("validarCambioDeOperacion (#957)", () => {
  it("apartar desde en preparación: etapa, subestado inicial y etapa vieja Reservado", () => {
    expect(validarCambioDeOperacion(venta("EN_PREPARACION"), { etapa: "APARTADO" })).toEqual({
      ok: true,
      datos: { etapa: "APARTADO", subestado: "PENDIENTE_DE_PAGO" },
      stage: "RESERVED",
    });
  });

  it("un negocio de antes (sin etapa ni tipo) recibe su tipo por el flujo al volverse operación", () => {
    const r = validarCambioDeOperacion({ tipoOperacion: null, etapa: null, flujo: "F1_CORRETAJE_VENDEDOR" }, { etapa: "EN_PREPARACION" });
    expect(r).toMatchObject({ ok: true, datos: { tipoOperacion: "CONTRATO_INTERMEDIACION", etapa: "EN_PREPARACION", subestado: null } });
  });

  it("no se salta etapas (salvo un administrador)", () => {
    expect(validarCambioDeOperacion(venta("EN_PREPARACION"), { etapa: "FIRMA" })).toMatchObject({ ok: false, campo: "etapa" });
    expect(validarCambioDeOperacion(venta("APARTADO"), { etapa: "EN_PREPARACION" })).toMatchObject({ ok: false, campo: "etapa" });
    expect(validarCambioDeOperacion(venta("POSTVENTA"), { etapa: "CANCELADA" })).toMatchObject({ ok: false, campo: "etapa" });
    expect(validarCambioDeOperacion(venta("EN_PREPARACION"), { etapa: "FIRMA" }, { forzar: true })).toMatchObject({ ok: true, stage: "CONTRACT_SIGNED" });
    expect(validarCambioDeOperacion(venta("EN_PREPARACION"), { etapa: "INVENTADA" })).toMatchObject({ ok: false, error: "Esa etapa no existe" });
  });

  it("el tipo solo cambia en preparación", () => {
    expect(validarCambioDeOperacion(venta("EN_PREPARACION"), { tipoOperacion: "CONTRATO_MB" })).toMatchObject({ ok: true, datos: { tipoOperacion: "CONTRATO_MB" } });
    expect(validarCambioDeOperacion(venta("APARTADO"), { tipoOperacion: "CONTRATO_MB" })).toMatchObject({ ok: false, campo: "tipoOperacion" });
  });

  it("las dos casillas en Firma prenden el devengo (y la etapa vieja pasa a Ganado)", () => {
    const firma = venta("FIRMA", { subestado: "FIRMADO", contratoFirmado: true });
    expect(validarCambioDeOperacion(firma, { enganchePagado: true })).toEqual({
      ok: true,
      datos: { enganchePagado: true, subestado: "DEVENGO_ACTIVO" },
      stage: "WON",
    });
    // Con una sola casilla no hay devengo.
    expect(validarCambioDeOperacion(venta("FIRMA", { subestado: "AGENDADA" }), { subestado: "DEVENGO_ACTIVO" })).toMatchObject({
      ok: false,
      campo: "subestado",
    });
    // Apartado con las dos marcadas: al pasar a Firma entra directo en devengo.
    const apartado = venta("APARTADO", { subestado: "PAGADO", contratoFirmado: true, enganchePagado: true });
    expect(validarCambioDeOperacion(apartado, { etapa: "FIRMA" })).toMatchObject({ ok: true, datos: { subestado: "DEVENGO_ACTIVO" }, stage: "WON" });
  });

  it("con el devengo activo no se quitan casillas; a Escritura solo con devengo", () => {
    const devengo = venta("FIRMA", { subestado: "DEVENGO_ACTIVO", contratoFirmado: true, enganchePagado: true });
    expect(validarCambioDeOperacion(devengo, { enganchePagado: false })).toMatchObject({ ok: false, campo: "contratoFirmado" });
    expect(validarCambioDeOperacion(devengo, { etapa: "ESCRITURA" })).toMatchObject({ ok: true, datos: { etapa: "ESCRITURA", subestado: "EN_TRAMITE_NOTARIAL" }, stage: "WON" });
    expect(validarCambioDeOperacion(venta("FIRMA", { subestado: "FIRMADO", contratoFirmado: true }), { etapa: "ESCRITURA" })).toMatchObject({
      ok: false,
      campo: "etapa",
    });
  });

  it("subestado: de la etapa, y no se deja vacío donde hay lista", () => {
    expect(validarCambioDeOperacion(venta("APARTADO", { subestado: "PENDIENTE_DE_PAGO" }), { subestado: "PAGADO" })).toEqual({
      ok: true,
      datos: { subestado: "PAGADO" },
      stage: "RESERVED",
    });
    expect(validarCambioDeOperacion(venta("APARTADO"), { subestado: "ESCRITURADO" })).toMatchObject({ ok: false, campo: "subestado" });
    expect(validarCambioDeOperacion(venta("APARTADO", { subestado: "PAGADO" }), { subestado: null })).toMatchObject({ ok: false, campo: "subestado" });
    expect(validarCambioDeOperacion(venta("APARTADO", { flujo: "F2_CORRETAJE_COMPRADOR" }), { subestado: "FINANCIAMIENTO_EN_TRAMITE" })).toMatchObject({
      ok: false,
    });
  });

  it("reapartar solo en Apartado, y la etapa vieja no se mueve", () => {
    expect(validarCambioDeOperacion(venta("APARTADO", { subestado: "PAGADO" }), { reapartar: true })).toEqual({
      ok: true,
      datos: { reapartar: true },
      stage: null,
    });
    expect(validarCambioDeOperacion(venta("FIRMA", { subestado: "AGENDADA" }), { reapartar: true })).toMatchObject({ ok: false, campo: "reapartar" });
    expect(validarCambioDeOperacion(venta("EN_PREPARACION"), { etapa: "APARTADO", reapartar: true })).toMatchObject({ ok: false });
  });

  it("cancelar deja la etapa vieja en Perdido y sin subestado", () => {
    expect(validarCambioDeOperacion(venta("APARTADO", { subestado: "PAGADO" }), { etapa: "CANCELADA" })).toEqual({
      ok: true,
      datos: { etapa: "CANCELADA", subestado: null },
      stage: "LOST",
    });
  });
});

describe("Ficha del contacto (#957)", () => {
  it("separa operaciones (activas, en preparación, canceladas) de los negocios anteriores", () => {
    const deals = [
      { id: "a", etapa: null, stage: "NEGOTIATION" },
      { id: "b", etapa: "CANCELADA" },
      { id: "c", etapa: "EN_PREPARACION" },
      { id: "d", etapa: "FIRMA" },
      { id: "e", etapa: "APARTADO" },
    ];
    const { operaciones, anteriores } = separarOperaciones(deals);
    expect(operaciones.map((d) => d.id)).toEqual(["d", "e", "c", "b"]);
    expect(anteriores.map((d) => d.id)).toEqual(["a"]);
  });

  it("las casillas de la firma se ven en Apartado y Firma de venta e intermediación", () => {
    expect(muestraCasillas("VENTA", "APARTADO")).toBe(true);
    expect(muestraCasillas("CONTRATO_INTERMEDIACION", "FIRMA")).toBe(true);
    expect(muestraCasillas("CONTRATO_MB", "FIRMA")).toBe(false);
    expect(muestraCasillas("VENTA", "ESCRITURA")).toBe(false);
    expect(etiquetaEtapa(null)).toBe("Negocio anterior");
    expect(etiquetaEtapa("FIRMA")).toBe("Firma");
  });
});

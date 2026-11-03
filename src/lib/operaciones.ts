// #957 — Operaciones (entrega 2 de #953): lo que antes era «Negocios», según Luis (02-nov).
//
// Antes del apartado, el avance del cliente vive en el estado del contacto (lib/estados.ts). Desde el
// apartado —o la firma del contrato o convenio—, cada compra es una OPERACIÓN dentro del contacto,
// con su etapa (Apartado, Firma, Escritura, Postventa) y su subestado. La tabla es la misma de los
// negocios (`deals`), así que comisiones, metas, reportes e inventario siguen leyendo lo mismo: la
// etapa nueva se traduce a la etapa vieja (`stage`) y la API vieja aplica sus reglas de siempre
// (unidad para apartar, hold del Hub, inventario, cálculo de comisión al ganar).
//
// «En preparación» (decisión de sistemas@, 03-nov): las cotizaciones cuelgan de un negocio y se
// cotiza en Propuesta, antes del apartado. Para cotizar se crea una operación en preparación que no
// mueve el estado del contacto; al apartar, esa misma se vuelve la venta.
//
// Lista única: los enums de schema.prisma y la migración 2026-11-03-operaciones.sql dicen lo mismo
// (lo comprueba operaciones.test.ts).

import { ESTADOS_POR_OPERACION, subestadosDe, type Estado } from "@/lib/estados";

export const TIPO_OPERACION_ORDER = ["VENTA", "CONTRATO_INTERMEDIACION", "CONTRATO_MB", "CONVENIO_ALIADO"] as const;
export type TipoOperacion = (typeof TIPO_OPERACION_ORDER)[number];

export const TIPO_OPERACION_LABELS: Record<TipoOperacion, string> = {
  VENTA: "Venta",
  CONTRATO_INTERMEDIACION: "Contrato de intermediación",
  CONTRATO_MB: "Contrato MB",
  CONVENIO_ALIADO: "Convenio de aliado",
};

export const ETAPA_OPERACION_ORDER = ["EN_PREPARACION", "APARTADO", "FIRMA", "ESCRITURA", "POSTVENTA", "CANCELADA"] as const;
export type EtapaOperacion = (typeof ETAPA_OPERACION_ORDER)[number];

export const ETAPA_OPERACION_LABELS: Record<EtapaOperacion, string> = {
  EN_PREPARACION: "En preparación",
  APARTADO: "Apartado",
  FIRMA: "Firma",
  ESCRITURA: "Escritura",
  POSTVENTA: "Postventa",
  CANCELADA: "Cancelada",
};

export const ETAPA_OPERACION_COLORS: Record<EtapaOperacion, string> = {
  EN_PREPARACION: "#9CA3AF",
  APARTADO: "#0D9488",
  FIRMA: "#059669",
  ESCRITURA: "#16A34A",
  POSTVENTA: "#65A30D",
  CANCELADA: "#B91C1C",
};

/** Etiqueta de un negocio de antes del #957 (sin etapa): pendiente de pasar al contacto (#958). */
export const NEGOCIO_ANTERIOR_LABEL = "Negocio anterior";

export const FORMA_PAGO_ORDER = ["CONTADO", "CREDITO_BANCARIO", "FINANCIAMIENTO_DIRECTO"] as const;
export type FormaPago = (typeof FORMA_PAGO_ORDER)[number];
export const FORMA_PAGO_LABELS: Record<FormaPago, string> = {
  CONTADO: "Contado (V1)",
  CREDITO_BANCARIO: "Crédito bancario (V2)",
  FINANCIAMIENTO_DIRECTO: "Financiamiento directo (V3)",
};

export const NIVEL_MB_ORDER = ["MB1", "MB2", "MB3"] as const;

/** Etapas que cuentan como operación activa y mueven el estado del contacto. */
export const ETAPAS_ACTIVAS: readonly EtapaOperacion[] = ["APARTADO", "FIRMA", "ESCRITURA", "POSTVENTA"];
/** Estados del contacto que vienen de una operación: la ficha no los ofrece en el chip de estado. */
export const ESTADOS_DE_OPERACION: readonly Estado[] = ESTADOS_POR_OPERACION;

export function esTipoOperacion(v: unknown): v is TipoOperacion {
  return typeof v === "string" && (TIPO_OPERACION_ORDER as readonly string[]).includes(v);
}
export function esEtapaOperacion(v: unknown): v is EtapaOperacion {
  return typeof v === "string" && (ETAPA_OPERACION_ORDER as readonly string[]).includes(v);
}
export function etiquetaEtapa(e: string | null | undefined): string {
  return e && esEtapaOperacion(e) ? ETAPA_OPERACION_LABELS[e] : NEGOCIO_ANTERIOR_LABEL;
}

/** Tipo de operación según el flujo del contacto (Luis, 02-nov). Sin flujo: Venta. */
export function tipoPorFlujo(flujo: string | null | undefined): TipoOperacion {
  switch (flujo) {
    case "F1_CORRETAJE_VENDEDOR":
      return "CONTRATO_INTERMEDIACION";
    case "F3_CAPTACION_MB":
      return "CONTRATO_MB";
    case "F6_BROKER":
    case "F7_INMOBILIARIA":
      return "CONVENIO_ALIADO";
    default:
      return "VENTA";
  }
}

// ───────────────────────────── etapas por tipo ─────────────────────────────

// La venta se aparta, se firma, se escritura y entra a postventa. El contrato de intermediación
// (F1) nace al firmarse y, cuando la propiedad se vende, recibe valor y sigue a escritura. El
// contrato MB (F3) y el convenio de aliado (F6, F7) terminan en la firma.
const SIGUIENTES: Record<TipoOperacion, Partial<Record<EtapaOperacion, readonly EtapaOperacion[]>>> = {
  VENTA: {
    EN_PREPARACION: ["APARTADO", "CANCELADA"],
    APARTADO: ["FIRMA", "CANCELADA"],
    FIRMA: ["ESCRITURA", "CANCELADA"],
    ESCRITURA: ["POSTVENTA"],
  },
  CONTRATO_INTERMEDIACION: {
    EN_PREPARACION: ["FIRMA", "CANCELADA"],
    FIRMA: ["ESCRITURA", "CANCELADA"],
    ESCRITURA: ["POSTVENTA"],
  },
  CONTRATO_MB: {
    EN_PREPARACION: ["FIRMA", "CANCELADA"],
    FIRMA: ["CANCELADA"],
  },
  CONVENIO_ALIADO: {
    EN_PREPARACION: ["FIRMA", "CANCELADA"],
    FIRMA: ["CANCELADA"],
  },
};

/** A qué etapas puede pasar. Un negocio de antes (sin etapa) cuenta como «en preparación». */
export function siguientesEtapas(tipo: string | null | undefined, etapa: string | null | undefined): EtapaOperacion[] {
  const t: TipoOperacion = esTipoOperacion(tipo) ? tipo : "VENTA";
  const e: EtapaOperacion = esEtapaOperacion(etapa) ? etapa : "EN_PREPARACION";
  return [...(SIGUIENTES[t][e] ?? [])];
}

/** Subestados de la etapa (los mismos de la pestaña «Subestados v0.2» para esos estados). */
export function subestadosDeEtapa(
  etapa: string | null | undefined,
  opts: { flujo?: string | null; tipo?: string | null } = {},
): { valor: string; etiqueta: string }[] {
  if (!etapa || !(ETAPAS_ACTIVAS as readonly string[]).includes(etapa)) return [];
  const lista = subestadosDe(etapa as Estado, opts.flujo ?? null);
  // Devengo activo: solo donde hay comisión al firmar (F1, F2, F4, F5 = venta e intermediación).
  const conDevengo = !opts.tipo || opts.tipo === "VENTA" || opts.tipo === "CONTRATO_INTERMEDIACION";
  return lista.filter((o) => conDevengo || o.valor !== "DEVENGO_ACTIVO");
}
export function subestadoInicial(etapa: EtapaOperacion, opts: { flujo?: string | null; tipo?: string | null } = {}): string | null {
  return subestadosDeEtapa(etapa, opts)[0]?.valor ?? null;
}

// ───────────────────────────── etapa vieja ─────────────────────────────

/**
 * Etapa vieja (`stage`) de la operación. Con esto la API vieja hace lo de siempre: RESERVED pide
 * unidad y aparta en el Hub; WON calcula la comisión. Luis: la comisión se activa en Firma ·
 * Devengo activo (contrato firmado + enganche pagado), y de ahí en adelante queda ganada.
 */
export function etapaALegacy(etapa: EtapaOperacion, subestado: string | null | undefined): string {
  switch (etapa) {
    case "EN_PREPARACION":
      return "PROPOSAL_SENT";
    case "APARTADO":
      return "RESERVED";
    case "FIRMA":
      return subestado === "DEVENGO_ACTIVO" ? "WON" : "CONTRACT_SIGNED";
    case "ESCRITURA":
    case "POSTVENTA":
      return "WON";
    case "CANCELADA":
      return "LOST";
  }
}

// ───────────────────────────── validación del cambio ─────────────────────────────

export interface OperacionActual {
  tipoOperacion: string | null;
  etapa: string | null;
  subestado?: string | null;
  contratoFirmado?: boolean | null;
  enganchePagado?: boolean | null;
  flujo?: string | null;
}

export interface CambioDeOperacion {
  tipoOperacion?: string;
  etapa?: string;
  subestado?: string | null;
  contratoFirmado?: boolean;
  enganchePagado?: boolean;
  reapartar?: boolean;
}

export interface DatosDeOperacion {
  tipoOperacion?: TipoOperacion;
  etapa?: EtapaOperacion;
  subestado?: string | null;
  contratoFirmado?: boolean;
  enganchePagado?: boolean;
  reapartar?: boolean;
}

export type ResultadoOperacion =
  | { ok: true; datos: DatosDeOperacion; stage: string | null }
  | { ok: false; error: string; campo: string };

/**
 * Decide si el cambio que pidió alguien sobre una operación se puede guardar, qué columnas se
 * escriben y a qué etapa vieja corresponde (null = la etapa vieja no cambia). No toca la base.
 *   - La etapa sigue SIGUIENTES según el tipo, salvo `forzar` (administrador).
 *   - Firma · Devengo activo pide Contrato firmado y Enganche pagado; con las dos en Sí estando en
 *     Firma, el subestado pasa solo a Devengo activo.
 *   - A Escritura solo se llega con el devengo activo.
 *   - Reapartar: solo en Apartado (suma al contador; la API renueva el hold).
 *   - El tipo solo se cambia mientras está en preparación.
 */
export function validarCambioDeOperacion(
  actual: OperacionActual,
  cambio: CambioDeOperacion,
  opts: { forzar?: boolean } = {},
): ResultadoOperacion {
  const etapaActual: EtapaOperacion = esEtapaOperacion(actual.etapa) ? actual.etapa : "EN_PREPARACION";
  const datos: DatosDeOperacion = {};

  // Tipo.
  let tipo: TipoOperacion = esTipoOperacion(actual.tipoOperacion) ? actual.tipoOperacion : tipoPorFlujo(actual.flujo);
  if (cambio.tipoOperacion !== undefined && cambio.tipoOperacion !== actual.tipoOperacion) {
    if (!esTipoOperacion(cambio.tipoOperacion)) return { ok: false, error: "Ese tipo de operación no existe", campo: "tipoOperacion" };
    if (etapaActual !== "EN_PREPARACION" && !opts.forzar) {
      return { ok: false, error: "El tipo solo se cambia mientras la operación está en preparación", campo: "tipoOperacion" };
    }
    tipo = cambio.tipoOperacion;
    datos.tipoOperacion = tipo;
  } else if (!esTipoOperacion(actual.tipoOperacion)) {
    datos.tipoOperacion = tipo; // un negocio de antes recibe su tipo al volverse operación
  }

  // Etapa.
  let etapa: EtapaOperacion = etapaActual;
  const tocaEtapa = cambio.etapa !== undefined && (cambio.etapa !== actual.etapa || actual.etapa === null);
  if (tocaEtapa) {
    if (!esEtapaOperacion(cambio.etapa)) return { ok: false, error: "Esa etapa no existe", campo: "etapa" };
    const destino = cambio.etapa;
    if (destino !== etapaActual && !opts.forzar && !siguientesEtapas(tipo, etapaActual).includes(destino)) {
      return {
        ok: false,
        error: `De ${ETAPA_OPERACION_LABELS[etapaActual]} no se puede pasar a ${ETAPA_OPERACION_LABELS[destino]} en un ${TIPO_OPERACION_LABELS[tipo].toLowerCase()}`,
        campo: "etapa",
      };
    }
    etapa = destino;
    datos.etapa = destino;
  }

  // Casillas de la firma.
  const contrato = cambio.contratoFirmado ?? actual.contratoFirmado ?? false;
  const enganche = cambio.enganchePagado ?? actual.enganchePagado ?? false;
  if (cambio.contratoFirmado !== undefined) datos.contratoFirmado = cambio.contratoFirmado;
  if (cambio.enganchePagado !== undefined) datos.enganchePagado = cambio.enganchePagado;
  const quitaCasilla = (cambio.contratoFirmado === false && actual.contratoFirmado) || (cambio.enganchePagado === false && actual.enganchePagado);
  if (quitaCasilla && actual.subestado === "DEVENGO_ACTIVO" && !opts.forzar) {
    return { ok: false, error: "Con el devengo activo ya no se quitan las casillas (pídelo a un administrador)", campo: "contratoFirmado" };
  }

  // Subestado.
  const opciones = subestadosDeEtapa(etapa, { flujo: actual.flujo, tipo });
  let subestado: string | null = tocaEtapa ? subestadoInicial(etapa, { flujo: actual.flujo, tipo }) : actual.subestado ?? null;
  if (cambio.subestado !== undefined) {
    if (cambio.subestado === null) {
      if (opciones.length > 0) return { ok: false, error: "Elige un subestado", campo: "subestado" };
    } else if (!opciones.some((o) => o.valor === cambio.subestado)) {
      return { ok: false, error: `Ese subestado no es de ${ETAPA_OPERACION_LABELS[etapa]}`, campo: "subestado" };
    }
    subestado = cambio.subestado;
  }
  if (subestado === "DEVENGO_ACTIVO" && !(contrato && enganche)) {
    return { ok: false, error: "Devengo activo pide Contrato firmado y Enganche pagado", campo: "subestado" };
  }
  // Las dos casillas en Sí estando en Firma: devengo activo.
  if (etapa === "FIRMA" && contrato && enganche && opciones.some((o) => o.valor === "DEVENGO_ACTIVO")) {
    subestado = "DEVENGO_ACTIVO";
  }
  if (subestado !== (actual.subestado ?? null) || tocaEtapa) datos.subestado = subestado;

  // A Escritura solo con el devengo activo.
  if (tocaEtapa && etapa === "ESCRITURA" && actual.subestado !== "DEVENGO_ACTIVO" && !opts.forzar) {
    return { ok: false, error: "Para pasar a Escritura, la firma tiene que estar en Devengo activo (contrato firmado y enganche pagado)", campo: "etapa" };
  }

  // Reapartar.
  if (cambio.reapartar) {
    if (etapa !== "APARTADO" || tocaEtapa) return { ok: false, error: "Solo se reaparta una operación que ya está en Apartado", campo: "reapartar" };
    datos.reapartar = true;
  }

  const stageNuevo = etapaALegacy(etapa, subestado);
  const cambiaStage = tocaEtapa || datos.subestado !== undefined;
  return { ok: true, datos, stage: cambiaStage ? stageNuevo : null };
}

/** Claves del PATCH de /api/deals/[id] que maneja este módulo. */
export const CLAVES_DE_OPERACION = ["tipoOperacion", "etapa", "subestado", "contratoFirmado", "enganchePagado", "reapartar"] as const;

// ───────────────────────────── ficha del contacto ─────────────────────────────

export interface OperacionDeFicha {
  id: string;
  etapa?: string | null;
  tipoOperacion?: string | null;
  subestado?: string | null;
  stage?: string | null;
  createdAt?: string | Date | null;
}

/**
 * Separa los negocios del contacto: operaciones (con etapa; las activas primero, luego en
 * preparación, al final las canceladas) y «negocios anteriores» (sin etapa: de antes del #957, los
 * mueve la #958). Los ganados ya llegan como Venta · Firma por el llenado de la migración.
 */
export function separarOperaciones<T extends OperacionDeFicha>(deals: readonly T[]): { operaciones: T[]; anteriores: T[] } {
  const peso = (e: string | null | undefined) =>
    e === "CANCELADA" ? 2 : e === "EN_PREPARACION" ? 1 : 0;
  const operaciones = deals.filter((d) => esEtapaOperacion(d.etapa)).map((d, i) => ({ d, i }));
  operaciones.sort((a, b) => peso(a.d.etapa) - peso(b.d.etapa) || a.i - b.i);
  return {
    operaciones: operaciones.map((x) => x.d),
    anteriores: deals.filter((d) => !esEtapaOperacion(d.etapa)),
  };
}

/** Texto del botón para avanzar a una etapa (Cancelar va aparte, con confirmación). */
export const ACCION_DE_ETAPA: Record<EtapaOperacion, string> = {
  EN_PREPARACION: "Usar para cotizar o apartar",
  APARTADO: "Apartar",
  FIRMA: "Pasar a firma",
  ESCRITURA: "Pasar a escritura",
  POSTVENTA: "Pasar a postventa",
  CANCELADA: "Cancelar",
};

/** Las casillas de la firma se ven desde el apartado (se pueden ir marcando) y en la firma. */
export function muestraCasillas(tipo: string | null | undefined, etapa: string | null | undefined): boolean {
  const conDevengo = !tipo || tipo === "VENTA" || tipo === "CONTRATO_INTERMEDIACION";
  return conDevengo && (etapa === "APARTADO" || etapa === "FIRMA");
}

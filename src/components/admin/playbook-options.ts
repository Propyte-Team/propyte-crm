// Opciones de una pregunta tipo "elegir de una lista" del playbook — módulo PURO.
//
// Antes se editaban como texto "valor:sinónimo1,sinónimo2" (una línea por opción). Ahora la
// pantalla las muestra como filas (opción + sinónimos en chips). La FORMA GUARDADA no cambia:
// BotTask.enumOptions sigue siendo [{ value, synonyms }] (lo lee playbook/capture.ts).
import { CONTACT_TYPE_LABELS, PROPERTY_TYPE_LABELS, etiqueta } from "@/lib/labels";
import { NATIVE_TARGET_FIELDS } from "@/lib/bot/playbook/fields";

export interface OpcionEnum {
  value: string;
  synonyms: string[];
}

export const MAX_SINONIMOS = 20;
export const MAX_LARGO_SINONIMO = 60;

// Etiquetas en español de los valores de los campos nativos tipo lista. La clave técnica
// (IMMEDIATE, CONTADO…) es lo que se guarda y solo se ve en el tooltip.
const VALORES_POR_CAMPO: Record<string, Record<string, string>> = {
  propertyType: PROPERTY_TYPE_LABELS,
  contactType: CONTACT_TYPE_LABELS,
  purchaseTimeline: {
    IMMEDIATE: "Inmediata",
    ONE_TO_THREE_MONTHS: "De 1 a 3 meses",
    THREE_TO_SIX_MONTHS: "De 3 a 6 meses",
    SIX_PLUS_MONTHS: "Más de 6 meses",
  },
  paymentMethod: {
    CONTADO: "Contado",
    CREDITO_HIPOTECARIO: "Crédito hipotecario",
    FINANCIAMIENTO_DIRECTO: "Financiamiento directo",
    MIXTO: "Mixto",
  },
  purchaseModality: {
    PREVENTA: "Preventa",
    ENTREGA_INMEDIATA: "Entrega inmediata",
    REVENTA: "Reventa",
    ABIERTO: "Abierto a opciones",
  },
  rentalStrategy: {
    LONG_TERM: "Renta a largo plazo",
    AIRBNB: "Renta vacacional (Airbnb)",
    BOTH: "Ambas",
    NA: "No aplica",
  },
  investmentProfile: {
    END_USER: "Para vivir (usuario final)",
    INVESTOR_RENTAL: "Inversionista: renta",
    INVESTOR_FLIP: "Inversionista: reventa",
    INVESTOR_LAND: "Inversionista: terrenos",
    MIXED: "Mixto",
  },
};

/** true si la lista de valores la fija el sistema (campo nativo con enum): no se pueden inventar valores. */
export function tieneValoresFijos(targetField: string): boolean {
  return !!NATIVE_TARGET_FIELDS[targetField]?.enumValues;
}

/** Etiqueta en español de un valor; para campos personalizados (o valores desconocidos) devuelve el valor tal cual. */
export function etiquetaDeValor(targetField: string, value: string): string {
  const dict = VALORES_POR_CAMPO[targetField];
  if (!dict) return value;
  return etiqueta(dict, value);
}

/** Opciones de fábrica de un campo nativo (una por valor del sistema, sin sinónimos). */
export function opcionesDeFabrica(targetField: string): OpcionEnum[] {
  return (NATIVE_TARGET_FIELDS[targetField]?.enumValues ?? []).map((value) => ({ value, synonyms: [] }));
}

/** Lee lo guardado (Json) a filas editables; tolera basura. */
export function leerOpciones(json: unknown): OpcionEnum[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((o): o is Record<string, unknown> => o !== null && typeof o === "object")
    .map((o) => ({
      value: String(o.value ?? ""),
      synonyms: Array.isArray(o.synonyms) ? o.synonyms.map(String) : [],
    }))
    .filter((o) => o.value.length > 0);
}

/**
 * Agrega sinónimos escritos por la persona. Acepta varios separados por coma o salto de línea,
 * recorta espacios y no repite (sin distinguir mayúsculas, ni contra el valor mismo).
 */
export function agregarSinonimos(actuales: readonly string[], texto: string, valor = ""): string[] {
  const salida = [...actuales];
  for (const crudo of texto.split(/[,\n]/)) {
    const s = crudo.replace(/\s+/g, " ").trim().slice(0, MAX_LARGO_SINONIMO);
    if (!s || salida.length >= MAX_SINONIMOS) continue;
    const bajo = s.toLowerCase();
    if (bajo === valor.trim().toLowerCase() || salida.some((x) => x.toLowerCase() === bajo)) continue;
    salida.push(s);
  }
  return salida;
}

export function quitarSinonimo(actuales: readonly string[], sinonimo: string): string[] {
  return actuales.filter((s) => s !== sinonimo);
}

/**
 * Forma que se guarda: sin filas sin valor, valores únicos (gana la primera), sinónimos limpios.
 * Es lo que antes hacía parseEnumOptionsText al leer el textarea.
 */
export function opcionesParaGuardar(filas: readonly OpcionEnum[]): OpcionEnum[] {
  const vistos = new Set<string>();
  const salida: OpcionEnum[] = [];
  for (const f of filas) {
    const value = f.value.trim();
    if (!value || vistos.has(value)) continue;
    vistos.add(value);
    salida.push({ value, synonyms: agregarSinonimos([], f.synonyms.join(","), value) });
  }
  return salida;
}

/** Aviso en español si las opciones no se pueden guardar (null = bien). */
export function errorDeOpciones(filas: readonly OpcionEnum[]): string | null {
  const validas = opcionesParaGuardar(filas);
  if (validas.length === 0) return "Agrega al menos una opción.";
  if (validas.length < filas.filter((f) => f.value.trim()).length) return "Hay opciones repetidas.";
  return null;
}

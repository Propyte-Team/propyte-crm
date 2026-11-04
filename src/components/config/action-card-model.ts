// Lógica pura de la tarjeta de acción (E3, 964): qué input sale por campo, cómo se arma el
// `raw` que edita la UI desde la config guardada y cómo se filtran las listas por fuente.
// Sin React: la tarjeta (action-card.tsx) solo pinta lo que este modelo decide.
import {
  accionPorTipo, camposVisibles, configParaGuardar, opcionesDeCampo, ACCIONES, GRUPOS_DE_ACCION,
  type AccionDeCatalogo, type CampoDeAccion, type FuenteDeCampo, type GrupoDeAccion,
} from "@/lib/workflows/action-catalog";

export interface PlantillaLista { id: string; clave?: string | null; nombre: string; canal: string; idioma?: string }
export interface CadenciaLista { id: string; nombre: string }
export interface UsuarioLista { id: string; nombre: string; rol?: string }
export interface ListasDeFuentes {
  plantillas: PlantillaLista[];
  cadencias: CadenciaLista[];
  usuarios: UsuarioLista[];
}
export const LISTAS_VACIAS: ListasDeFuentes = { plantillas: [], cadencias: [], usuarios: [] };

export interface AccionEditable {
  type: string;
  config: Record<string, unknown>;
  delayMinutes?: number | null;
}
export interface OpcionDeInput { value: string; label: string }

export type InputDeCampo = "text" | "textarea" | "number" | "minutos" | "checkbox" | "select" | "fuente";

/** Presets de retraso de la acción (minutos). */
export const PRESETS_DE_RETRASO: { label: string; minutes: number }[] = [
  { label: "Inmediata", minutes: 0 },
  { label: "15 min", minutes: 15 },
  { label: "1 h", minutes: 60 },
  { label: "1 día", minutes: 1440 },
];

/** Qué control pinta un campo. number con unidad "min" usa el DelayInput (minutos con unidad). */
export function inputDeCampo(campo: CampoDeAccion): InputDeCampo {
  if (campo.kind === "number") return campo.unidad === "min" ? "minutos" : "number";
  return campo.kind;
}

/** Config guardada → valores editables: números a texto (inputs), booleanos se conservan; claves desconocidas se conservan. */
export function rawDesdeConfig(config: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config ?? {})) {
    if (v === undefined || v === null) continue;
    raw[k] = typeof v === "number" ? String(v) : v;
  }
  return raw;
}

export function valorTexto(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

export function valorCheckbox(raw: Record<string, unknown>, key: string): boolean {
  const v = raw[key];
  return v === true || v === "true";
}

/** Opciones de una lista según la fuente. Plantillas se filtran por canal. */
export function opcionesDeFuente(fuente: FuenteDeCampo | undefined, listas: ListasDeFuentes): OpcionDeInput[] {
  switch (fuente) {
    case "plantillas_whatsapp":
      return listas.plantillas.filter((p) => p.canal === "WHATSAPP").map((p) => ({ value: p.id, label: p.nombre }));
    case "plantillas_email":
      return listas.plantillas.filter((p) => p.canal === "EMAIL").map((p) => ({ value: p.id, label: p.nombre }));
    case "cadencias":
      return listas.cadencias.map((c) => ({ value: c.id, label: c.nombre }));
    case "usuarios":
      return listas.usuarios.map((u) => ({ value: u.id, label: u.nombre }));
    default:
      return [];
  }
}

/** Opciones estáticas de un select ya resueltas (considera dependeDe). */
export function opcionesDeSelect(campo: CampoDeAccion, raw: Record<string, unknown>): OpcionDeInput[] {
  const mapa = opcionesDeCampo(campo, raw) ?? {};
  return Object.entries(mapa).map(([value, label]) => ({ value, label }));
}

/**
 * Opciones del control de un campo (select o fuente). `valorFueraDeLista` = hay un valor guardado
 * que no está entre las opciones (clave de plantilla, texto libre): la UI lo muestra en vez de borrarlo.
 */
export function opcionesDeInput(
  campo: CampoDeAccion, raw: Record<string, unknown>, listas: ListasDeFuentes,
): { opciones: OpcionDeInput[]; valorFueraDeLista: string | null } {
  const opciones = campo.kind === "fuente" ? opcionesDeFuente(campo.fuente, listas) : opcionesDeSelect(campo, raw);
  const actual = valorTexto(raw, campo.key);
  const fuera = actual !== "" && !opciones.some((o) => o.value === actual) ? actual : null;
  return { opciones, valorFueraDeLista: fuera };
}

/** Valor del <select> cuando se está escribiendo texto libre. */
export const VALOR_OTRO = "__otro__";

/** Valor del <select>: "" vacío, VALOR_OTRO cuando es texto libre (permiteOtro). */
export function valorDeSelect(campo: CampoDeAccion, raw: Record<string, unknown>, listas: ListasDeFuentes, modoOtro: boolean): string {
  if (modoOtro) return VALOR_OTRO;
  const { valorFueraDeLista } = opcionesDeInput(campo, raw, listas);
  if (valorFueraDeLista !== null) return campo.permiteOtro ? VALOR_OTRO : valorFueraDeLista;
  return valorTexto(raw, campo.key);
}

/**
 * Cambia un valor del `raw`. Si otro campo depende de éste (UPDATE_FIELD.value depende de field),
 * ese campo se limpia: sus opciones ya no aplican.
 */
export function cambiarRaw(type: string, raw: Record<string, unknown>, key: string, valor: unknown): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw, [key]: valor };
  for (const campo of camposVisibles(type, raw)) {
    if (campo.dependeDe === key) delete next[campo.key];
  }
  return next;
}

/** Arma la acción lista para guardar a partir del `raw` editado. Conserva claves desconocidas. */
export function accionDesdeRaw(
  type: string, raw: Record<string, unknown>, delayMinutes?: number | null,
): AccionEditable {
  const out: AccionEditable = { type, config: configParaGuardar(type, raw) };
  if (typeof delayMinutes === "number" && delayMinutes > 0) out.delayMinutes = delayMinutes;
  return out;
}

/** Retraso del DelayInput (minutos como texto, "" = inmediata) → número o undefined. */
export function retrasoDesdeTexto(texto: string): number | undefined {
  if (texto === "") return undefined;
  const n = Number(texto);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function retrasoATexto(minutos: number | null | undefined): string {
  return typeof minutos === "number" && minutos > 0 ? String(minutos) : "";
}

/** Acción nueva con la config por defecto vacía. */
export function accionNueva(type: string): AccionEditable {
  return { type, config: {} };
}

export interface GrupoDeAcciones { grupo: GrupoDeAccion; acciones: AccionDeCatalogo[] }

/** Acciones ofrecibles agrupadas (solo `activo`; las `proximamente` no se ofrecen). */
export function accionesAgrupadas(): GrupoDeAcciones[] {
  return GRUPOS_DE_ACCION
    .map((grupo) => ({ grupo, acciones: ACCIONES.filter((a) => a.grupo === grupo && a.estado === "activo") }))
    .filter((g) => g.acciones.length > 0);
}

export function etiquetaDeAccion(type: string): string {
  return accionPorTipo(type)?.label ?? type;
}

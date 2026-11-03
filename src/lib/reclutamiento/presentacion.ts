// Bot de reclutamiento (plan 2026-11-03, Task 7) — cómo se LEE en pantalla lo que el bot guardó:
// origen, veredicto, motivo y respuestas. Módulo PURO (sin Prisma ni React): lo usan la tabla, el
// diálogo del candidato y sus pruebas.
import { etiquetaCustom, valorCustom } from "@/lib/timeline/custom";
import { PREFIJO_CUSTOM, claveCustom } from "./respuestas";
import { VEREDICTOS, type Veredicto } from "./etapas";
import type { CandidatoFila } from "./shared";

// --------------- origen ---------------

const CANALES: Record<string, string> = { WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram", MESSENGER: "Messenger" };
const ORIGEN_LABEL: Record<string, string> = { MANUAL: "Manual", CHAT: "Chat", NOTION: "Notion", CONTACTO: "Contactos" };

export function canalLabel(canal: string | null | undefined): string | null {
  return (canal && CANALES[canal]) || null;
}

/** MANUAL → «Manual»; CHAT → el canal en texto («Instagram») o «Chat» si no se sabe. */
export function origenLabel(f: Pick<CandidatoFila, "source" | "botCanal">): string {
  if (f.source === "CHAT") return canalLabel(f.botCanal) ?? "Chat";
  return ORIGEN_LABEL[f.source] ?? f.source;
}

// --------------- veredicto ---------------

/** Clase de `globals.css` (.badge-*): verde, ámbar y gris con las variables del tema. */
export const VEREDICTO_INFO: Record<Veredicto, { label: string; clase: string }> = {
  APTO: { label: "Apto", clase: "badge-success" },
  REVISAR: { label: "Revisar", clase: "badge-warning" },
  NO_APTO: { label: "No apto", clase: "badge-neutral" },
};

export function esVeredicto(v: unknown): v is Veredicto {
  return typeof v === "string" && (VEREDICTOS as readonly string[]).includes(v);
}

/** Chips de filtro (`filtrarCandidatos({ veredicto })`). «Sin evaluar» = botResultado null, venga de donde venga. */
export const SIN_EVALUAR = "SIN_EVALUAR";
export const FILTROS_VEREDICTO = [
  ...VEREDICTOS.map((v) => ({ code: v as string, label: VEREDICTO_INFO[v].label })),
  { code: SIN_EVALUAR, label: "Sin evaluar" },
] as const;

export type EstadoBot =
  | { tipo: "veredicto"; veredicto: Veredicto; label: string; clase: string; puntaje: string | null }
  | { tipo: "en_guion" }
  | null;

/** Lo que va en la columna «Bot»: veredicto+puntaje, «En guion» (chat sin evaluar) o nada. */
export function estadoBot(f: Pick<CandidatoFila, "source" | "botResultado" | "botPuntaje">): EstadoBot {
  if (esVeredicto(f.botResultado)) {
    const info = VEREDICTO_INFO[f.botResultado];
    return { tipo: "veredicto", veredicto: f.botResultado, ...info, puntaje: textoPuntaje(f.botPuntaje) };
  }
  return f.source === "CHAT" ? { tipo: "en_guion" } : null;
}

export function textoPuntaje(p: number | null | undefined): string | null {
  return typeof p === "number" && Number.isFinite(p) ? `${Math.round(p)}/100` : null;
}

// --------------- motivo y respuestas ---------------

const sinPrefijo = (clave: string) => (clave.startsWith(PREFIJO_CUSTOM) ? clave.slice(PREFIJO_CUSTOM.length) : clave);

/** «movilidad» o «reclutamiento_movilidad» → «Movilidad» (la etiqueta de custom.ts sin «Reclutamiento: »). */
export function etiquetaRespuesta(clave: string): string {
  const texto = etiquetaCustom(claveCustom(sinPrefijo(clave))).replace(/^Reclutamiento:\s*/i, "").trim();
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : clave;
}

/** El valor guardado (enum) en palabras: «SOLO_DISPOSICION» → «solo disposición, sin vehículo». */
export function valorRespuesta(clave: string, valor: unknown): string {
  return valorCustom(claveCustom(sinPrefijo(clave)), valor);
}

/** `filtro:movilidad` → «No pasó el filtro: Movilidad»; `ambiguo:a,b` → «Respuesta ambigua: A, B»; `puntaje` → «Por puntaje». */
export function motivoLegible(motivo: string | null | undefined): string | null {
  const m = motivo?.trim();
  if (!m) return null;
  if (m === "puntaje") return "Por puntaje";
  const i = m.indexOf(":");
  const tipo = i === -1 ? m : m.slice(0, i);
  const resto = i === -1 ? "" : m.slice(i + 1);
  const claves = resto.split(",").map((c) => c.trim()).filter(Boolean);
  const etiquetas = claves.map(etiquetaRespuesta).join(", ");
  if (tipo === "filtro" && etiquetas) return `No pasó el filtro: ${etiquetas}`;
  if (tipo === "ambiguo" && etiquetas) return `Respuesta ambigua: ${etiquetas}`;
  return m;
}

/** El orden del guion; lo desconocido va al final, en el orden en que llegó. */
const ORDEN = [
  "mayor_edad", "plaza", "acepta_comision", "disponibilidad", "colchon_meses", "movilidad",
  "experiencia_inmobiliaria", "cartera_clientes", "experiencia_ventas", "ingles", "prospeccion_digital",
  "actitud_1", "actitud_2", "actitud_3",
];

export type RespuestaLegible = { clave: string; etiqueta: string; valor: string };

/** botRespuestas (Json, con o sin prefijo `reclutamiento_`) → lista para leer. Vacíos fuera. */
export function respuestasLegibles(r: unknown): RespuestaLegible[] {
  if (!r || typeof r !== "object" || Array.isArray(r)) return [];
  const filas = Object.entries(r as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => ({ clave: sinPrefijo(k), etiqueta: etiquetaRespuesta(k), valor: valorRespuesta(k, v) }));
  const pos = (c: string) => (ORDEN.indexOf(c) === -1 ? ORDEN.length : ORDEN.indexOf(c));
  return filas.map((f, i) => ({ f, i })).sort((a, b) => pos(a.f.clave) - pos(b.f.clave) || a.i - b.i).map((x) => x.f);
}

// --------------- contacto ---------------

/** Solo dígitos, para `wa.me/` (no entiende «+», espacios ni guiones). null si no queda ninguno. */
export function hrefWhatsApp(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  return d ? `https://wa.me/${d}` : null;
}

export function hrefConversacion(f: Pick<CandidatoFila, "conversationId">): string | null {
  return f.conversationId ? `/inbox?c=${encodeURIComponent(f.conversationId)}` : null;
}

// Evaluación pura del candidato (spec §3.3). Sin BD, sin IA: recibe respuestas, los puntos de
// actitud ya calculados y el modelo, y devuelve filtros, puntaje, desglose y resultado.
import type { Veredicto } from "./etapas";
import { CLAVES_FILTRO, CLAVES_PUNTUABLE, type ModeloReclutamiento } from "./modelo";
import type { Respuestas } from "./respuestas";

export type EstadoFiltro = "PASA" | "FALLA" | "AMBIGUO";
export type Filtros = Record<(typeof CLAVES_FILTRO)[number], EstadoFiltro>;
export type Desglose = Record<string, number | null>;

export interface Evaluacion {
  filtros: Filtros;
  puntaje: number;
  desglose: Desglose;
  resultado: Veredicto;
  /** `filtro:<clave>` | `ambiguo:<clave>` | `puntaje` | null (APTO limpio). */
  motivo: string | null;
}

export function evaluar(input: {
  respuestas: Respuestas;
  actitudPuntos: number | null;
  cvRecibido: boolean;
  modelo: ModeloReclutamiento;
}): Evaluacion {
  const { respuestas, modelo } = input;

  const filtros = {} as Filtros;
  for (const clave of CLAVES_FILTRO) {
    const f = modelo.filtros[clave];
    if (!f || !f.activo) { filtros[clave] = "PASA"; continue; }
    const v = respuestas[clave];
    if (!v) { filtros[clave] = "AMBIGUO"; continue; }
    filtros[clave] = f.pasa.includes(v) ? "PASA" : f.ambiguo.includes(v) ? "AMBIGUO" : "FALLA";
  }

  const desglose: Desglose = {};
  let puntaje = 0;
  for (const clave of CLAVES_PUNTUABLE) {
    const p = modelo.puntuables[clave];
    const v = respuestas[clave];
    // Object.hasOwn evita recorrer el prototipo ("constructor" daría una función, no un número).
    const bruto = p && v && Object.hasOwn(p.puntos, v) ? p.puntos[v] : 0;
    const pts = typeof bruto === "number" && Number.isFinite(bruto) ? bruto : 0;
    desglose[clave] = pts;
    puntaje += pts;
  }
  // Actitud no numérica o no finita (NaN, Infinity) se trata como ausente: no suma.
  const actitud =
    typeof input.actitudPuntos === "number" && Number.isFinite(input.actitudPuntos)
      ? Math.max(0, Math.min(modelo.actitudMax, Math.round(input.actitudPuntos)))
      : null;
  desglose.actitud = actitud;
  puntaje += actitud ?? 0;
  const cv = input.cvRecibido ? modelo.cvPuntos : 0;
  desglose.cv_recibido = cv;
  puntaje += cv;
  puntaje = Math.min(100, Math.round(puntaje));

  const fallados = CLAVES_FILTRO.filter((c) => filtros[c] === "FALLA");
  const ambiguos = CLAVES_FILTRO.filter((c) => filtros[c] === "AMBIGUO");

  let resultado: Veredicto;
  let motivo: string | null = null;
  if (fallados.length > 0) {
    resultado = "NO_APTO"; motivo = `filtro:${fallados[0]}`;
  } else if (ambiguos.length > 1) {
    resultado = "NO_APTO"; motivo = `ambiguo:${ambiguos.join(",")}`;
  } else if (ambiguos.length === 1) {
    // Un solo filtro sin respuesta clara: lo decide un humano si el resto es fuerte.
    resultado = puntaje >= modelo.umbrales.apto ? "REVISAR" : "NO_APTO";
    motivo = `ambiguo:${ambiguos[0]}`;
  } else if (puntaje >= modelo.umbrales.apto) {
    resultado = "APTO";
  } else if (puntaje >= modelo.umbrales.revisar) {
    resultado = "REVISAR"; motivo = "puntaje";
  } else {
    resultado = "NO_APTO"; motivo = "puntaje";
  }

  return { filtros, puntaje, desglose, resultado, motivo };
}

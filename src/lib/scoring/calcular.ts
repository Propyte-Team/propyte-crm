// Cálculo del lead score — función PURA (sin Prisma), spec §2.
//
// La misma función sirve para el cálculo en vivo (lib/scoring/recalcular.ts) y para el
// backtest (scripts/scoring-backtest.ts): así lo que se calibra es exactamente lo que corre.
import { FAMILIAS, TIPOS_ACTIVIDAD_ENTRANTE, type Familia, type ModeloScore, type Regla } from "./modelo";

export interface ContactoScore {
  contactType?: string | null;
  contactStatus?: string | null;
  doNotContact?: boolean | null;
  leadSource?: string | null;
  purchaseTimeline?: string | null;
  urgency?: string | null;
  paymentMethod?: string | null;
  investmentProfile?: string | null;
  phone?: string | null;
  email?: string | null;
  budgetMin?: number | string | null;
  budgetMax?: number | string | null;
  /** `custom.budget_currency` ("USD" | "MXN"); sin valor se asume MXN. */
  budgetCurrency?: string | null;
  lastActivityAt?: Date | string | null;
  [campo: string]: unknown;
}

export interface SenalesScore {
  /** Actividades (no canceladas) con su tipo y fecha. */
  actividades: { tipo: string; fecha: Date }[];
  /** Fechas de mensajes entrantes (tabla messages), cualquier canal. */
  entrantes: Date[];
  playbookCompletado: boolean;
  web?: { daysVisited?: number | null; chatCount?: number | null; visitorScore?: number | null } | null;
}

export interface LineaDesglose {
  regla: string;
  etiqueta: string;
  familia: Familia;
  puntos: number;
  veces?: number;
}

export interface ResultadoScore {
  /** null = contacto excluido (no es comprador). */
  score: number | null;
  desglose: LineaDesglose[];
  /** Motivo cuando el score es null o quedó en 0 por estado. */
  motivo?: string;
  /** Factor de decaimiento aplicado (1 = sin decaimiento). */
  decaimiento: number;
  version: number;
}

const DIA = 86_400_000;

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Puntos de una regla de eventos: la primera vale `puntosPrimera`, las demás `puntosAdicional`, con tope. */
function puntosPorEventos(n: number, primera: number, adicional: number, max?: number): number {
  if (n <= 0) return 0;
  const p = primera + (n - 1) * adicional;
  return max === undefined ? p : Math.min(p, max);
}

function evaluar(regla: Regla, c: ContactoScore, s: SenalesScore, ahora: number): { puntos: number; veces?: number } {
  switch (regla.tipo) {
    case "campo": {
      const v = texto(c[regla.campo]);
      return { puntos: v !== null ? regla.valores[v] ?? 0 : 0 };
    }
    case "campos_presentes":
      return { puntos: regla.campos.every((k) => texto(c[k]) !== null) ? regla.puntos : 0 };
    case "presupuesto": {
      const monto = numero(c.budgetMax) ?? numero(c.budgetMin);
      if (monto === null || monto <= 0) return { puntos: 0 };
      const mxn = (texto(c.budgetCurrency) ?? "MXN").toUpperCase() === "USD" ? monto * regla.tipoCambioUSD : monto;
      const escalon = [...regla.escalones].sort((a, b) => b.minMXN - a.minMXN).find((e) => mxn >= e.minMXN);
      return { puntos: escalon?.puntos ?? 0 };
    }
    case "actividad": {
      const desde = ahora - regla.dentroDeDias * DIA;
      const n = s.actividades.filter((a) => regla.tipos.includes(a.tipo) && a.fecha.getTime() >= desde).length;
      return { puntos: puntosPorEventos(n, regla.puntosPrimera, regla.puntosAdicional, regla.maxPuntos), veces: n || undefined };
    }
    case "entrantes": {
      const desde = ahora - regla.dentroDeDias * DIA;
      const n =
        s.entrantes.filter((d) => d.getTime() >= desde).length +
        s.actividades.filter((a) => TIPOS_ACTIVIDAD_ENTRANTE.includes(a.tipo) && a.fecha.getTime() >= desde).length;
      return { puntos: puntosPorEventos(n, regla.puntosPrimera, regla.puntosAdicional, regla.maxPuntos), veces: n || undefined };
    }
    case "playbook_completado":
      return { puntos: s.playbookCompletado ? regla.puntos : 0 };
    case "web": {
      const v = numero(s.web?.[regla.campo]);
      return { puntos: v !== null && v >= regla.min ? regla.puntos : 0 };
    }
  }
}

/** Última señal de interés: la actividad o entrada más reciente; si no hay, lastActivityAt. */
function ultimaSenal(c: ContactoScore, s: SenalesScore): number | null {
  let max: number | null = null;
  for (const a of s.actividades) max = Math.max(max ?? 0, a.fecha.getTime());
  for (const d of s.entrantes) max = Math.max(max ?? 0, d.getTime());
  if (max !== null) return max;
  if (c.lastActivityAt) {
    const t = new Date(c.lastActivityAt).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function calcularScore(c: ContactoScore, s: SenalesScore, m: ModeloScore, ahora: Date = new Date()): ResultadoScore {
  const base = { desglose: [] as LineaDesglose[], decaimiento: 1, version: m.version };

  const tipo = texto(c.contactType);
  if (tipo && m.tiposExcluidos.includes(tipo)) return { ...base, score: null, motivo: `Tipo de contacto ${tipo}: no se califica` };
  const estado = texto(c.contactStatus);
  if (estado && m.estadosAnulan.includes(estado)) return { ...base, score: 0, motivo: `Estado ${estado}` };
  if (c.doNotContact) return { ...base, score: 0, motivo: "No contactar" };

  const t = ahora.getTime();
  const ultima = ultimaSenal(c, s);
  const periodos = ultima === null ? 0 : Math.max(0, Math.floor((t - ultima) / (m.decaimiento.cadaDias * DIA)));
  const factor = Math.pow(1 - m.decaimiento.porcentaje / 100, periodos);

  const desglose: LineaDesglose[] = [];
  const porFamilia = Object.fromEntries(FAMILIAS.map((f) => [f, 0])) as Record<Familia, number>;
  for (const regla of m.reglas) {
    const { puntos, veces } = evaluar(regla, c, s, t);
    if (puntos === 0) continue;
    const ajustado = m.decaimiento.familias.includes(regla.familia) ? Math.round(puntos * factor) : puntos;
    if (ajustado === 0) continue;
    desglose.push({ regla: regla.id, etiqueta: regla.etiqueta, familia: regla.familia, puntos: ajustado, ...(veces ? { veces } : {}) });
    porFamilia[regla.familia] += ajustado;
  }

  let total = 0;
  for (const f of FAMILIAS) {
    const tope = m.topesPorFamilia[f];
    total += tope === undefined ? porFamilia[f] : Math.min(porFamilia[f], tope);
  }
  const score = Math.max(0, Math.min(m.maximo, Math.round(total)));
  return { score, desglose, decaimiento: factor, version: m.version };
}

/**
 * Umbrales cruzados al pasar de `antes` a `despues` (en cualquier dirección). Con scoring activo,
 * solo un cruce emite `contact.scored`: un cambio de 1 punto dentro del mismo tramo no inunda la
 * cola de workflows ni re-dispara CAPI.
 */
export function umbralesCruzados(antes: number | null, despues: number | null, umbrales: { min: number }[]): number[] {
  const a = antes ?? 0;
  const d = despues ?? 0;
  return umbrales.map((u) => u.min).filter((min) => (a >= min) !== (d >= min));
}

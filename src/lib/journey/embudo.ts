// J1 (#985) — Embudo del Journey: cuántos contactos hay en cada estado del flujograma, cuántos
// entraron en la ventana, cuántos avanzaron, cuánto suelen tardar y cuántos están atorados.
// Puro: sin Prisma ni React. La API (api/admin/journey/embudo) trae los datos; aquí se calculan.
import { ESTADO_ORDER, ESTADOS_SALIDA, type Estado } from "@/lib/estados";

const DIA_MS = 86_400_000;

/** Estados que forman el embudo, en orden: los 11 activos (sin salidas ni especiales). */
export const PASOS_EMBUDO: readonly Estado[] = ESTADO_ORDER.slice(0, 11);
/** Estados que no son parte del recorrido: se cuentan aparte. */
export const ESTADOS_ESPECIALES: readonly Estado[] = ["REGISTRADO_POR_BROKER", "DERIVADO_A_RH"];

/** Cargas masivas del 03-04 nov (#953, #957, #958): no son movimientos de personas. */
export const FUENTES_MASIVAS: readonly string[] = [
  "estado_llenado_953",
  "estado_migracion_958",
  "operaciones_llenado_957",
];

/** Con menos que esto no se muestra porcentaje ni «suelen tardar»: la muestra engaña. */
/** Quién ve el embudo (Luis 2026-11-04): gerencia y dirección. Un archivo de ruta no puede exportarlo. */
export const ROLES_EMBUDO = ["ADMIN", "DIRECTOR", "GERENTE"];

export const MIN_MUESTRA_PORCENTAJE = 5;
/** Con 3 salidas rápidas la mediana daba 0,9 días y marcaba 219 de 220 «Nuevo» como atorados (prod 2026-11-05). */
export const MIN_MUESTRA_MEDIANA = 10;
/** Primer día con el estado registrado en el historial. */
export const DESDE_HISTORIAL = "2026-11-03";

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** ¿El cambio lo hizo una carga masiva? Lista conocida, o cualquier fuente con «llenado» o «migracion». */
export function esFuenteMasiva(source: string | null | undefined): boolean {
  if (!source) return false;
  const s = sinAcentos(source).toLowerCase();
  if (FUENTES_MASIVAS.includes(s)) return true;
  return s.includes("llenado") || s.includes("migracion");
}

// ───────────────────────────── reglas por paso ─────────────────────────────

export const CUALQUIER_MOMENTO = "CUALQUIER_MOMENTO" as const;
export type PasoDeRegla = Estado | typeof CUALQUIER_MOMENTO;

// Etapa del negocio (disparador STAGE_CHANGE) → estado equivalente del contacto (§3.1 del diseño).
const ETAPA_A_ESTADO: Record<string, Estado> = {
  NEW_LEAD: "NUEVO",
  CONTACTED: "CONTACTADO",
  MEETING_SCHEDULED: "REUNION",
  MEETING_COMPLETED: "REUNION",
  PROPOSAL_SENT: "PROPUESTA",
  NEGOTIATION: "PROPUESTA",
  RESERVED: "APARTADO",
  CONTRACT_SIGNED: "FIRMA",
  CLOSING: "FIRMA",
  WON: "POSTVENTA",
};

/**
 * En qué paso del embudo actúa una regla. Los disparadores por etapa de negocio caen en el estado
 * equivalente; los de evento (lead nuevo, pago vencido), tiempo o inactividad van a
 * «En cualquier momento».
 */
const EVENTO_A_ESTADO: Record<string, PasoDeRegla> = { "deal.won": "POSTVENTA", "visit.completed": "REUNION" };

export function pasoDeRegla(regla: {
  triggerType: string;
  triggerConfig?: Record<string, unknown> | null;
}): PasoDeRegla {
  if (regla.triggerType === "STAGE_CHANGE") {
    const t = regla.triggerConfig?.toStage;
    if (typeof t === "string" && ETAPA_A_ESTADO[t]) return ETAPA_A_ESTADO[t];
  }
  // Eventos que sí pertenecen a un paso: ganar el negocio es la entrada a Postventa (WF8).
  if (regla.triggerType === "EVENT") {
    const e = regla.triggerConfig?.eventType;
    if (typeof e === "string" && EVENTO_A_ESTADO[e]) return EVENTO_A_ESTADO[e];
  }
  return CUALQUIER_MOMENTO;
}

// ───────────────────────────── cálculo ─────────────────────────────

export interface CambioDeEstado {
  contactId: string;
  desde: string | null;
  hasta: string | null;
  en: Date;
  source?: string | null;
  /** Cuándo entró el contacto al estado del que sale (para «cuánto tardó»). Null si no se sabe. */
  desdeEn?: Date | null;
}

/** Contacto que hoy está en un estado y desde cuándo (último cambio hacia él, o su alta). */
export interface Estancia {
  contactId: string;
  estado: string;
  desde: Date;
}

export interface PasoEmbudo {
  estado: Estado;
  hoy: number;
  entraron: number;
  avanzaron: number;
  /** Mediana de días que pasaron en el estado los que salieron de él en la ventana. */
  medianaDias: number | null;
  muestraMediana: number;
  atorados: number;
}

export interface DesdePaso {
  /** null = no se sabe de dónde salió. */
  estado: string | null;
  n: number;
}

export interface SalidaEmbudo {
  estado: Estado;
  hoy: number;
  entraron: number;
  desde: DesdePaso[];
}

export interface Embudo {
  pasos: PasoEmbudo[];
  salidas: SalidaEmbudo[];
  especiales: SalidaEmbudo[];
  porClasificar: number;
}

export interface EntradaEmbudo {
  /** Contactos hoy por estado; la clave vacía o «null» es «Por clasificar». */
  conteosHoy: Record<string, number>;
  cambios: CambioDeEstado[];
  estancias?: Estancia[];
  ahora: Date;
  dias: number;
}

export function mediana(valores: number[]): number | null {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const indicePaso = (e: string | null): number => (e ? PASOS_EMBUDO.indexOf(e as Estado) : -1);

/** Porcentaje entero, o null si entraron menos de MIN_MUESTRA_PORCENTAJE (muestra chica = sin %). */
export function porcentajeAvance(entraron: number, avanzaron: number): number | null {
  if (entraron < MIN_MUESTRA_PORCENTAJE) return null;
  return Math.round((avanzaron / entraron) * 100);
}

function agrupaDesde(cambios: CambioDeEstado[]): DesdePaso[] {
  const m = new Map<string | null, Set<string>>();
  // Un contacto cuenta una vez por paso de origen.
  for (const c of cambios) {
    const k = c.desde ?? null;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(c.contactId);
  }
  return [...m.entries()]
    .map(([estado, ids]) => ({ estado, n: ids.size }))
    .sort((a, b) => b.n - a.n);
}

export function calcularEmbudo({ conteosHoy, cambios, estancias = [], ahora, dias }: EntradaEmbudo): Embudo {
  const corte = ahora.getTime() - dias * DIA_MS;
  const enVentana = cambios.filter((c) => !esFuenteMasiva(c.source) && c.en.getTime() >= corte);

  const hoyDe = (e: string) => conteosHoy[e] ?? 0;

  // Cambios de cada contacto por orden de fecha, para saber si «avanzó» después de entrar.
  const porContacto = new Map<string, CambioDeEstado[]>();
  for (const c of enVentana) {
    if (!porContacto.has(c.contactId)) porContacto.set(c.contactId, []);
    porContacto.get(c.contactId)!.push(c);
  }
  for (const lista of porContacto.values()) lista.sort((a, b) => a.en.getTime() - b.en.getTime());

  const pasos: PasoEmbudo[] = PASOS_EMBUDO.map((estado, idx) => {
    const entradas = enVentana.filter((c) => c.hasta === estado);
    const quienes = new Set(entradas.map((c) => c.contactId));

    let avanzaron = 0;
    for (const id of quienes) {
      const lista = porContacto.get(id) ?? [];
      const primera = lista.find((c) => c.hasta === estado)!;
      const adelante = lista.some((c) => c.en.getTime() > primera.en.getTime() && indicePaso(c.hasta) > idx);
      if (adelante) avanzaron += 1;
    }

    const dur = enVentana
      .filter((c) => c.desde === estado && c.desdeEn)
      .map((c) => Math.max(0, (c.en.getTime() - c.desdeEn!.getTime()) / DIA_MS));
    const med = dur.length >= MIN_MUESTRA_MEDIANA ? mediana(dur) : null;

    // «Atorado»: lleva en el estado más del doble de lo habitual (mínimo un día).
    let atorados = 0;
    if (med !== null) {
      const umbral = Math.max(2 * med, 1);
      atorados = estancias.filter(
        (s) => s.estado === estado && (ahora.getTime() - s.desde.getTime()) / DIA_MS > umbral,
      ).length;
    }

    return {
      estado,
      hoy: hoyDe(estado),
      entraron: quienes.size,
      avanzaron,
      medianaDias: med,
      muestraMediana: dur.length,
      atorados,
    };
  });

  const aparte = (estado: Estado): SalidaEmbudo => {
    const entradas = enVentana.filter((c) => c.hasta === estado);
    return {
      estado,
      hoy: hoyDe(estado),
      entraron: new Set(entradas.map((c) => c.contactId)).size,
      desde: agrupaDesde(entradas),
    };
  };

  return {
    pasos,
    salidas: ESTADOS_SALIDA.map(aparte),
    especiales: ESTADOS_ESPECIALES.map(aparte),
    porClasificar: (conteosHoy[""] ?? 0) + (conteosHoy["null"] ?? 0),
  };
}

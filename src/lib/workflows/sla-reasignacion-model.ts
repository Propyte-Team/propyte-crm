/**
 * Reasignación por falta de primer contacto: la parte pura (sin base de datos).
 *
 * La regla: un lead que el reparto le entregó a un asesor y que no recibe un primer contacto
 * dentro de `minutosHabiles` (en horario laboral) pasa al siguiente asesor del turno. Un
 * inversionista, un asesor: nadie más le llama mientras tiene dueño, pero el dueño tiene que
 * contestar. Se apaga por defecto y se enciende en Configuración → Flujos de trabajo y SLA.
 *
 * Va aparte de `sla-reasignacion.ts` para probar los plazos y la lectura de la configuración
 * sin simular Prisma, igual que `escalacion.ts` respecto de `sla.ts`.
 */
import { z } from "zod";
import { computeDueAt, HORARIO_POR_DEFECTO, type BusinessHours } from "./business-hours";

/** Fila de `SystemConfig` con la configuración. Sin fila = apagado. */
export const CLAVE_REASIGNACION = "workflows.sla.reasignacion_primer_contacto";

/** Origen que deja en la bitácora (`RecordFieldChange.source`) cada reasignación. */
export const ORIGEN_REASIGNACION = "sla_reasignacion";

/**
 * Orígenes de un cambio de asesor que hizo el SISTEMA. Solo esos leads se reasignan: si un
 * líder o un gerente eligió a mano a quién dárselo, el sistema no le corrige la decisión.
 */
export const ORIGENES_DE_REPARTO = ["routing", "routing_marca", ORIGEN_REASIGNACION] as const;

/**
 * Cuánto tiempo, después de vencido el plazo, se sigue intentando la reasignación. Si el
 * cron estuvo caído más que esto, el lead se queda con su asesor: es preferible no mover
 * nada a mover de golpe una pila de leads viejos cuando el cron vuelve.
 */
export const VENTANA_MINUTOS = 120;

/**
 * Tipos de actividad que cuentan como «ya lo contactó». Incluye las llamadas registradas a
 * mano: el reloj FIRST_TOUCH solo lo cierran los envíos por SMS, WhatsApp, Gmail y el bot,
 * y un asesor que llamó por teléfono y lo anotó no debe perder el lead por eso.
 */
export const TIPOS_DE_CONTACTO = [
  "CALL_OUTBOUND",
  "WHATSAPP_OUT",
  "SMS_OUT",
  "INSTAGRAM_OUT",
  "MESSENGER_OUT",
  "EMAIL_SENT",
  "DISCOVERY_CALL",
  "MEETING_VIRTUAL",
  "MEETING_PRESENTIAL",
  "MEETING_SHOWROOM",
  "WALK_IN",
] as const;

export type ConfigReasignacion = {
  activo: boolean;
  /** Plazo para el primer contacto, en minutos de horario laboral. */
  minutosHabiles: number;
  /** Cuántas veces puede pasar un mismo lead de un asesor a otro por esta regla. */
  maxReasignaciones: number;
  /**
   * Desde cuándo está encendida (ISO). Los leads asignados antes no se tocan: encender la
   * regla no debe vaciar de golpe la cartera de leads viejos sin contactar.
   */
  activoDesde: string | null;
};

export const LIMITES = {
  minutosHabiles: { min: 15, max: 1440 },
  maxReasignaciones: { min: 1, max: 5 },
} as const;

export const CONFIG_POR_DEFECTO: ConfigReasignacion = {
  activo: false,
  minutosHabiles: 60,
  maxReasignaciones: 2,
  activoDesde: null,
};

/** Lo que la pantalla de Configuración puede mandar. */
export const configReasignacionSchema = z.object({
  activo: z.boolean(),
  minutosHabiles: z.number().int().min(LIMITES.minutosHabiles.min).max(LIMITES.minutosHabiles.max),
  maxReasignaciones: z.number().int().min(LIMITES.maxReasignaciones.min).max(LIMITES.maxReasignaciones.max),
});
export type EntradaConfigReasignacion = z.infer<typeof configReasignacionSchema>;

function enteroEnRango(v: unknown, min: number, max: number, def: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Lee el JSON guardado sin confiar en él: lo que falte o venga mal toma el valor por defecto. */
export function leerConfigReasignacion(valor: unknown): ConfigReasignacion {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return { ...CONFIG_POR_DEFECTO };
  const v = valor as Record<string, unknown>;
  const desde = typeof v.activoDesde === "string" && !Number.isNaN(Date.parse(v.activoDesde)) ? v.activoDesde : null;
  return {
    activo: v.activo === true,
    minutosHabiles: enteroEnRango(
      v.minutosHabiles, LIMITES.minutosHabiles.min, LIMITES.minutosHabiles.max, CONFIG_POR_DEFECTO.minutosHabiles,
    ),
    maxReasignaciones: enteroEnRango(
      v.maxReasignaciones, LIMITES.maxReasignaciones.min, LIMITES.maxReasignaciones.max, CONFIG_POR_DEFECTO.maxReasignaciones,
    ),
    activoDesde: desde,
  };
}

/**
 * La configuración que se guarda. `activoDesde` se sella al ENCENDER (no al guardar otro
 * cambio con la regla ya encendida, que dejaría fuera a los leads en curso) y se borra al
 * apagar, para que volver a encenderla tampoco arrastre lo que pasó mientras estuvo apagada.
 */
export function siguienteConfig(
  anterior: ConfigReasignacion,
  entrada: EntradaConfigReasignacion,
  ahora: Date,
): ConfigReasignacion {
  const activoDesde = !entrada.activo
    ? null
    : anterior.activo && anterior.activoDesde
      ? anterior.activoDesde
      : ahora.toISOString();
  return { ...entrada, activoDesde };
}

/** Horario de la política del reloj o, si no tiene, el horario laboral por defecto. */
export function horarioDeLaRegla(businessHours: unknown): BusinessHours {
  const bh = businessHours as BusinessHours | null | undefined;
  return bh && typeof bh === "object" && bh.days ? bh : HORARIO_POR_DEFECTO;
}

/**
 * Siempre en horario laboral, aunque la política del reloj no tenga uno: un lead que entra
 * a las 23:00 no se le quita a nadie a medianoche para dárselo a otro que tampoco está.
 */
export function venceReasignacion(asignadoEn: Date, minutosHabiles: number, businessHours: unknown): Date {
  return computeDueAt(asignadoEn, minutosHabiles, horarioDeLaRegla(businessHours));
}

export type EstadoDelPlazo = "en_plazo" | "vencido" | "fuera_de_ventana";

export function estadoDelPlazo(vence: Date, ahora: Date): EstadoDelPlazo {
  if (ahora < vence) return "en_plazo";
  return ahora.getTime() - vence.getTime() <= VENTANA_MINUTOS * 60_000 ? "vencido" : "fuera_de_ventana";
}

/** «1 h», «1 h 30 min», «45 min». */
export function formatoPlazo(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** El `reason` que viaja a la notificación del asesor nuevo y al evento `lead.reassigned`. */
export function motivoDelReparto(minutosHabiles: number): string {
  return `sin primer contacto en ${formatoPlazo(minutosHabiles)} hábil`;
}

export function avisoAlAnterior(
  nombre: string,
  fuente: string,
  minutosHabiles: number,
): { title: string; message: string } {
  return {
    title: "Lead reasignado por falta de primer contacto",
    message:
      `${nombre} (${fuente}) pasó a otro asesor: no hubo primer contacto en ` +
      `${formatoPlazo(minutosHabiles)} de horario laboral.`,
  };
}

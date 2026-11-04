// Lógica pura del editor de cadencias (E3): forma de los pasos, minutos acumulados y validación.
import { validarAccion, type FuentesDeAccion } from "@/lib/workflows/action-catalog";

export interface StepRow {
  actionType: string;
  delayMinutes: number;
  config: Record<string, unknown>;
  autonomyLevel: string;
}

/** Minutos desde que el contacto entra a la cadencia hasta cada paso (suma de esperas). */
export function minutosAcumulados(steps: Pick<StepRow, "delayMinutes">[]): number[] {
  let total = 0;
  return steps.map((s) => {
    total += Number.isFinite(s.delayMinutes) && s.delayMinutes > 0 ? s.delayMinutes : 0;
    return total;
  });
}

/** Primer problema de validación entre todos los pasos ("Paso 2 · Enviar WhatsApp: falta plantilla") o null. */
export function primerProblemaDePasos(steps: StepRow[], fuentes?: FuentesDeAccion): string | null {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const { problemas } = validarAccion(
      { type: s.actionType, config: s.config, delayMinutes: s.delayMinutes }, fuentes,
    );
    if (problemas.length > 0) return `Paso ${i + 1}: ${problemas[0]}`;
  }
  return null;
}

/** Paso nuevo: sin espera, autonomía L0 ("solo sugiere"). */
export function pasoNuevo(actionType: string): StepRow {
  return { actionType, delayMinutes: 0, config: {}, autonomyLevel: "L0" };
}

/** Índice del paso abierto tras mover `i` una posición (null si no había uno abierto). */
export function abiertaTrasMover(abierta: number | null, i: number, j: number): number | null {
  if (abierta === i) return j;
  if (abierta === j) return i;
  return abierta;
}

/** Índice del paso abierto tras quitar el paso `i`. */
export function abiertaTrasQuitar(abierta: number | null, i: number): number | null {
  if (abierta === null || abierta === i) return null;
  return abierta > i ? abierta - 1 : abierta;
}

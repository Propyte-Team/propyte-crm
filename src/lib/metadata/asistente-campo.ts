// Validación por paso del asistente «Nuevo campo» (paso 1: tipo y nombre; paso 2: opciones).
// Pura: sin React ni red.

export interface BorradorCampo {
  label: string;
  fieldType: string;
  options: string;
}

export type PasoCampo = 1 | 2;

/** Errores por campo del formulario para el paso indicado ({} = se puede avanzar). */
export function validarPasoCampo(paso: PasoCampo, b: BorradorCampo): Record<string, string> {
  const errores: Record<string, string> = {};
  if (paso === 1) {
    if (!b.label.trim()) errores.label = "Escribe cómo se llama el campo";
    if (!b.fieldType) errores.fieldType = "Elige el tipo de dato";
  } else if (b.fieldType === "PICKLIST") {
    const hay = b.options.split(/[,\n]/).some((o) => o.trim().length > 0);
    if (!hay) errores.options = "Agrega al menos una opción a la lista";
  }
  return errores;
}

/** Texto del resumen que se ve en el paso 2. */
export function resumenPaso1(b: Pick<BorradorCampo, "label" | "fieldType">, tipoLabel: string): string {
  return `${b.label.trim()} · ${tipoLabel}`;
}

// Las respuestas del candidato las escribe el playbook en Contact.custom con el prefijo
// `reclutamiento_` (ver segment-playbooks.ts). Aquí se leen tipadas; la evaluación las
// copia a recruitment_candidates.respuestas para que la UI no dependa del Json del contacto.
export const PREFIJO_CUSTOM = "reclutamiento_";
export const CLAVES_ACTITUD = ["actitud_1", "actitud_2", "actitud_3"] as const;

export type Respuestas = Record<string, string>;

export function leerRespuestas(custom: unknown): Respuestas {
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) return {};
  const out: Respuestas = {};
  for (const [k, v] of Object.entries(custom as Record<string, unknown>)) {
    if (!k.startsWith(PREFIJO_CUSTOM)) continue;
    if (typeof v !== "string" || !v.trim()) continue;
    out[k.slice(PREFIJO_CUSTOM.length)] = v;
  }
  return out;
}

export function claveCustom(clave: string): string {
  return `${PREFIJO_CUSTOM}${clave}`;
}

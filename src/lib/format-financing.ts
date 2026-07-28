// Formateo de plazos de financiamiento.
// financingMonths (Hub: financing_months int4[]) es un ARRAY de plazos (ej. [12,24,36,48,60]),
// no un escalar. Concatenar los números sin separador (o hacer aritmética con ellos) produce
// basura como "hasta 1224364860 meses" — ese fue el bug del plan original.
export function formatFinancingMonths(months: number[] | null): string | null {
  if (!months || months.length === 0) return null;
  return `${months.join("/")} meses`;
}

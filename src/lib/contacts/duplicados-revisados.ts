// "No es duplicado" y su deshacer (E7 #977). Las parejas viven en SystemConfig
// (contacts.duplicados_revisados = lista de firmas, ver app/api/contacts/duplicates/firma.ts).

/** Lee la lista guardada; ignora basura. */
export function leerRevisados(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((f): f is string => typeof f === "string") : [];
}

/** Quita una firma. Devuelve la lista nueva y si realmente estaba. */
export function quitarRevisado(lista: string[], firma: string): { lista: string[]; estaba: boolean } {
  const nueva = lista.filter((f) => f !== firma);
  return { lista: nueva, estaba: nueva.length !== lista.length };
}

/** ids de contacto contenidos en una firma ("a|b|c"). */
export function idsDeFirma(firma: string): string[] {
  return firma.split("|").filter(Boolean);
}

/** Las últimas `max` firmas, la más reciente primero (se guardan al final). */
export function recientes(lista: string[], max: number): string[] {
  return lista.slice(-max).reverse();
}
